import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/openai/client";
import { RECOMMENDATION_COMPOSE_MODEL } from "@/lib/openai/models";
import {
  buildFactsBlock,
  formatHistorySummary,
  recommendationSystemPrompt,
} from "@/lib/openai/prompts";
import { todayRecommendationSchema } from "@/lib/openai/schemas";
import { recommendationFingerprint } from "@/lib/facts";
import { getRecommendationContext, type ProgramDayCatalogEntry } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Give up on the model before the home screen feels stuck (fallback is instant). */
const MODEL_TIMEOUT_MS = 8000;

interface SuggestedLiftView {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
}

interface RecommendationPayload {
  suggested_focus: string;
  headline: string;
  reason: string;
  calendar_day_number: number;
  calendar_day_label: string | null;
  /** True when the suggestion differs from today's calendar label — drives the pill swap. */
  diverges: boolean;
  /** The suggested day's planned lifts, only when diverging ("Suggested lifts"); null on a match. */
  suggested_lifts: SuggestedLiftView[] | null;
}

/**
 * GET /api/recommendation — the AI-composed Today-card suggestion
 * (feature brief: ai-today-recommendation). Authed by middleware.ts like all /api/*.
 *
 * This is the app's first UNPROMPTED model call (page-load driven), so cost
 * discipline is load-bearing (repo rule 5 / AC #4): the result is cached by a
 * facts fingerprint (today + latest session id). A new log or a date rollover
 * shifts the fingerprint → regenerate; every other reload is a pure cache hit,
 * zero model calls.
 *
 * Separation of concerns (Risk #3): /api/program/today stays deterministic and
 * instant for the card's factual content; this route owns the fingerprint cache,
 * the model call, and the fallback. The card fetches both.
 *
 * Graceful fallback (AC #5): ANY failure — context fetch, model call, timeout —
 * returns `{ recommendation: null }` with 200. The card then renders its current
 * calendar-day header unchanged; no error state, never a broken header. Failures
 * are never cached (only a real composition is).
 */
export async function GET() {
  try {
    const ctx = await getRecommendationContext();
    const { base } = ctx;
    const fingerprint = recommendationFingerprint(base.today, ctx.latest_session_id);
    const sb = supabaseServer();

    // Cache hit → return the stored payload verbatim. Zero model calls (AC #4).
    const { data: cached } = await sb
      .from("daily_recommendations")
      .select("payload")
      .eq("fingerprint", fingerprint)
      .maybeSingle();
    if (cached?.payload) {
      return ok({ recommendation: cached.payload as RecommendationPayload });
    }

    // Allowed focuses = the program's own day labels (Risk #1). suggested_focus is
    // schema-constrained to these, so it always maps back to a real program day.
    const focuses = [...new Set(ctx.program_days.map((d) => d.label))];
    if (focuses.length === 0) return ok({ recommendation: null });

    const calendarLabel = base.day?.label ?? null;
    const plannedById = new Map(base.planned.map((p) => [p.id, p]));

    const factsBlock = buildFactsBlock({
      today: base.today,
      day_number: base.day_number,
      day_label: calendarLabel,
      day_notes: base.day?.notes ?? null,
      days_since_last_workout: base.days_since_last_workout,
      detraining: base.detraining,
      has_planned_lifts: base.planned.length > 0,
      remaining: base.remaining.map((r) => {
        const p = plannedById.get(r.planned.id);
        return {
          exercise_name: p?.exercise.name ?? "unknown",
          unit: p?.exercise.unit ?? "reps",
          sets_remaining: r.setsRemaining,
          sets_done: r.setsDone,
          target_sets: r.planned.target_sets,
          target_reps: r.planned.target_reps,
          target_weight: r.planned.target_weight,
          rest_seconds: r.planned.rest_seconds,
          notes: r.planned.notes,
        };
      }),
      pr_bests: [],
      next_pr_targets: [],
      history_summary: formatHistorySummary(ctx.history),
      muscle_recency: ctx.muscle_recency.map((m) => ({ muscle_group: m.muscle_group, days_since: m.days_since })),
      equipment: null,
    });

    const schema = todayRecommendationSchema(focuses as [string, ...string[]]);
    const response = await openai().responses.parse(
      {
        model: RECOMMENDATION_COMPOSE_MODEL,
        instructions: recommendationSystemPrompt(factsBlock, focuses, calendarLabel),
        input: "What should I train today? Give me the one-line home-screen suggestion.",
        text: { format: zodTextFormat(schema, "today_recommendation") },
      },
      { timeout: MODEL_TIMEOUT_MS },
    );

    const rec = response.output_parsed;
    if (!rec) return ok({ recommendation: null }); // no parseable output → fallback

    const diverges = rec.suggested_focus !== (calendarLabel ?? "");
    const payload: RecommendationPayload = {
      suggested_focus: rec.suggested_focus,
      headline: rec.headline,
      reason: rec.reason,
      calendar_day_number: base.day_number,
      calendar_day_label: calendarLabel,
      diverges,
      suggested_lifts: diverges ? liftsForFocus(ctx.program_days, rec.suggested_focus) : null,
    };

    // Cache the composition (best-effort — a cache-write failure must not fail the
    // response; worst case is one extra model call next load).
    await sb
      .from("daily_recommendations")
      .upsert({ rec_date: base.today, fingerprint, payload }, { onConflict: "fingerprint" });

    return ok({ recommendation: payload });
  } catch {
    // Any failure → graceful fallback to the calendar-day header (AC #5).
    return ok({ recommendation: null });
  }
}

/** Planned lifts of the (first) program day carrying `label` — "Suggested lifts" on divergence. */
function liftsForFocus(days: ProgramDayCatalogEntry[], label: string): SuggestedLiftView[] {
  const day = days.filter((d) => d.label === label).sort((a, b) => a.day_number - b.day_number)[0];
  if (!day) return [];
  return day.planned.map((p) => ({
    exercise_name: p.exercise_name,
    target_sets: p.target_sets,
    target_reps: p.target_reps,
    target_weight: p.target_weight,
    unit: p.unit,
  }));
}
