import { supabaseServer } from "@/lib/supabase/server";
import { LogRequestSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";

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
    const sb = supabaseServer();
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
    return ok({ session_id: session.id, set_count: rows.length }, 201);
  } catch (e) {
    return failFrom(e);
  }
}
