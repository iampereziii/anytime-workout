import { supabaseServer } from "@/lib/supabase/server";
import { detectNewPrs } from "@/lib/facts";
import { appToday, appTodayIso, isoDateDaysAgo, isWithinBackdateWindow } from "@/lib/dates";
import { LogRequestSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";
import type { Exercise, PrBest } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/log — persist a CONFIRMED session + sets. Both log doors land here
 * (combobox and parse) — nothing reaches this route without an explicit user
 * confirm (business rules 1, 5).
 *
 * Offline-queued writes replay here on reconnect with their original `date`
 * (business rule 10 — append-only, so no conflict resolution).
 *
 * Also detects new PRs (feature brief: pr-celebration-on-new-best): bests are
 * read BEFORE the insert (else the new sets pollute the pr_bests view), the
 * comparison is pure lib/facts code (ADR-0004), and a detection failure never
 * fails the save — celebration is garnish, the write is the meal.
 *
 * Atomicity note: supabase-js has no client transactions; on a sets-insert
 * failure we delete the just-created session (cascade removes any partial
 * sets) so a retry never double-writes.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = LogRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  }
  const { date, part, notes, sets } = parsed.data;

  try {
    // Server-side backdate window (feature brief AC #3), independent of the client's
    // UI guard: reject any date outside [app-today − 7, app-today] in the app's
    // pinned zone. This is what stops a "future" (from the server's viewpoint) row
    // from ever existing — the client can only ever help, never bypass this.
    const appNow = appToday();
    if (!isWithinBackdateWindow(date, appNow)) {
      const floorIso = isoDateDaysAgo(7, appNow);
      return fail(
        "date_out_of_window",
        `date ${date} is outside the allowed window [${floorIso}, ${appTodayIso()}]`,
        400,
      );
    }

    const sb = supabaseServer();

    // Pre-save snapshot for PR detection — degrade to no-celebration on failure.
    const exerciseIds = [...new Set(sets.map((s) => s.exercise_id))];
    let priorBests: PrBest[] = [];
    let exercises: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">[] = [];
    try {
      const [bestsRes, exRes] = await Promise.all([
        sb.from("pr_bests").select("*").in("exercise_id", exerciseIds),
        sb.from("exercises").select("id, name, unit, is_bodyweight").in("id", exerciseIds),
      ]);
      priorBests = (bestsRes.data ?? []) as PrBest[];
      exercises = exRes.data ?? [];
    } catch {
      // celebration data unavailable — the save still proceeds
    }

    const { data: session, error: sessionErr } = await sb
      .from("workout_sessions")
      .insert({ date, part, notes })
      .select("id")
      .single();
    if (sessionErr) return fail("db_error", sessionErr.message, 500);

    const rows = sets.map((s) => ({ ...s, session_id: session.id }));
    const { error: setsErr } = await sb.from("logged_sets").insert(rows);
    if (setsErr) {
      await sb.from("workout_sessions").delete().eq("id", session.id);
      return fail("db_error", setsErr.message, 500);
    }

    const nameById = new Map(exercises.map((e) => [e.id, e]));
    const new_prs = detectNewPrs(priorBests, sets, exercises).map((pr) => ({
      ...pr,
      exercise_name: nameById.get(pr.exercise_id)?.name ?? "",
      unit: nameById.get(pr.exercise_id)?.unit ?? "reps",
      is_bodyweight: nameById.get(pr.exercise_id)?.is_bodyweight ?? false,
    }));

    return ok({ session_id: session.id, set_count: rows.length, new_prs }, 201);
  } catch (e) {
    return failFrom(e);
  }
}
