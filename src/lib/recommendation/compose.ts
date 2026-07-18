import "server-only";
import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/openai/client";
import { RECOMMENDATION_COMPOSE_MODEL } from "@/lib/openai/models";
import {
  buildFactsBlock,
  formatHistorySummary,
  recommendationSystemPrompt,
  RECOMMENDATION_PROMPT_VERSION,
  type FactsCatalogLine,
} from "@/lib/openai/prompts";
import { todayRecommendationSchema, type TodayRecommendation } from "@/lib/openai/schemas";
import type { RecommendationContext } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * The ONE compose-and-pin path (ADR-0007 / ADR-0009). Two callers, same model call:
 *  - GET /api/recommendation on a pin miss — first compose of the day, insert-if-absent,
 *  - POST /api/recommendation/new — the owner's explicit re-roll, overwrite.
 *
 * Every model call for the Today card goes through here, so "exactly one call per
 * press, zero on a plain reload" is a property of this module plus its two callers,
 * not a coincidence between two copies of the prompt assembly (cost discipline —
 * CLAUDE.md #5).
 */

/** Give up on the model before the home screen feels stuck (fallback is instant). */
export const MODEL_TIMEOUT_MS = 8000;

/** Build the composer's facts block from the gathered context. */
function composeFacts(ctx: RecommendationContext): string {
  const nameById = new Map(ctx.exercises.map((e) => [e.id, e.name]));
  const catalog: FactsCatalogLine[] = ctx.exercises.map((e) => ({
    name: e.name,
    unit: e.unit,
    is_bodyweight: e.is_bodyweight,
    muscle_groups: e.muscle_groups,
    default_rest_seconds: e.default_rest_seconds,
    default_cue: e.default_cue,
  }));

  return buildFactsBlock({
    today: ctx.base.today,
    // Exact-time facts, accurate at compose time. Chat is the surface that can ask
    // about sleep; the composer is just told to be conservative when it's unknown.
    now: ctx.timing.now_clock,
    last_workout: ctx.timing.last_workout,
    sleep_state_ambiguous: ctx.timing.sleep_state_ambiguous,
    days_since_last_workout: ctx.base.days_since_last_workout,
    detraining: ctx.base.detraining,
    pr_bests: ctx.pr_bests.map((p) => ({
      exercise_name: p.exercise_name,
      is_bodyweight: p.is_bodyweight,
      unit: p.unit,
      best_reps: p.best_reps,
      best_weight: p.best_weight,
      achieved_on: p.achieved_on,
    })),
    next_pr_targets: ctx.next_targets.map((t) => ({
      exercise_name: nameById.get(t.exercise_id) ?? "unknown",
      target_reps: t.target_reps,
      target_weight: t.target_weight,
      rule_applied: t.rule_applied,
    })),
    history_summary: formatHistorySummary(ctx.history),
    muscle_recency: ctx.muscle_recency.map((m) => ({ muscle_group: m.muscle_group, days_since: m.days_since })),
    exercise_catalog: catalog,
    equipment: ctx.equipment,
  });
}

/**
 * Compose today's workout and pin it. Returns null when there is nothing to compose
 * from (empty catalog) or the model returns no parseable output — the caller's
 * graceful-fallback case. Throws only on a model/transport failure.
 *
 * `overwrite` is the ADR-0009 relaxation of ADR-0007 finding 4's all-day immutability:
 *  - false (first compose of the day): insert-if-absent — a concurrent first load that
 *    already pinned wins, so the day still settles on ONE recommendation,
 *  - true ("New recommendation"): replace the row. Safe now precisely because nothing
 *    tracks remaining against the pin — there is no count to jump and no bleed.
 *
 * A pin-write failure never fails the response: worst case is one extra compose on
 * the next load.
 */
export async function composeAndPin(
  ctx: RecommendationContext,
  { overwrite }: { overwrite: boolean },
): Promise<TodayRecommendation | null> {
  const allowed = ctx.exercises.map((e) => e.name);
  if (allowed.length === 0) return null;

  const factsBlock = composeFacts(ctx);
  const schema = todayRecommendationSchema(allowed as [string, ...string[]]);
  const response = await openai().responses.parse(
    {
      model: RECOMMENDATION_COMPOSE_MODEL,
      instructions: recommendationSystemPrompt(factsBlock, allowed),
      input: "Recommend today's workout: pick the focus and compose the lifts.",
      text: { format: zodTextFormat(schema, "today_recommendation") },
    },
    { timeout: MODEL_TIMEOUT_MS },
  );

  const rec = response.output_parsed;
  if (!rec) return null;

  await supabaseServer()
    .from("daily_recommendations")
    .upsert(
      {
        rec_date: ctx.base.today,
        payload: rec,
        prompt_version: RECOMMENDATION_PROMPT_VERSION,
        facts_block: factsBlock,
      },
      { onConflict: "rec_date", ignoreDuplicates: !overwrite },
    );

  return rec;
}
