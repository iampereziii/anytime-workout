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
import { remainingToday } from "@/lib/facts";
import { getRecommendationContext, resolveLiftIds, type TodayContext } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Give up on the model before the home screen feels stuck (fallback is instant). */
const MODEL_TIMEOUT_MS = 8000;

interface RecommendationLiftView {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
  rest_seconds: number | null;
  cue: string | null;
  /** Live progress against the pinned target (recomputed each load; ADR-0007 finding 4). */
  sets_done: number;
  sets_remaining: number;
}

interface RecommendationPayload {
  focus: string;
  headline: string;
  reason: string;
  is_recovery: boolean;
  /** The composed workout + live remaining counts, or null on a recovery day. */
  lifts: RecommendationLiftView[] | null;
  /** Total sets left across all lifts (0 on a recovery day / when complete). */
  remaining_count: number;
}

/** Deterministic base facts — always returned (even when the AI composition fails)
 *  so the card can render recency without a broken header. */
interface TodayView {
  date: string;
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

function toTodayView(base: TodayContext): TodayView {
  return {
    date: base.today,
    days_since_last_workout: base.days_since_last_workout,
    detraining: base.detraining,
    last_workout_date: base.last_workout_date,
  };
}

/**
 * GET /api/recommendation — the sole Today surface (ADR-0007). The AI generates the
 * full workout (focus + lifts + sets + reps + weight); progression targets and the
 * recovery-readiness gate stay deterministic and are fed as hard facts.
 *
 * Pinned per calendar day (finding 4): the recommendation is composed once on the
 * first load of the day and stored immutably (insert-if-absent, keyed by rec_date).
 * Every later load that day reuses it — zero model calls — and the remaining count
 * re-derives against the fixed target from today's logged sets, so "N left" never
 * jumps mid-workout. A date rollover is a natural recompose.
 *
 * The recovery gate is enforced deterministically: when the computed facts require
 * recovery, the route returns a recovery day WITHOUT a model call — the guardrail is
 * never handed back to the model whose judgment it exists to backstop.
 *
 * Graceful fallback (AC #5): ANY failure returns `{ recommendation: null }` with 200.
 * Failures are never pinned (only a real composition is).
 */
export async function GET() {
  let base: TodayContext | undefined;
  try {
    const ctx = await getRecommendationContext();
    base = ctx.base;
    const { exercises } = ctx;
    const sb = supabaseServer();

    // Cache hit → the day is already pinned. Zero model calls (finding 4 immutability).
    let rec: TodayRecommendation | null = ctx.pinned?.payload ?? null;
    let factsBlock: string | null = null;

    if (!rec) {
      if (ctx.recovery.recommended) {
        // Hard recovery gate — decided deterministically, never by the model.
        rec = {
          focus: "Active Recovery",
          headline: "Recovery First",
          reason: ctx.recovery.reason ?? "Every muscle group was trained within the last day.",
          is_recovery: true,
          lifts: null,
        };
      } else {
        const nameById = new Map(exercises.map((e) => [e.id, e.name]));
        const catalog: FactsCatalogLine[] = exercises.map((e) => ({
          name: e.name,
          unit: e.unit,
          is_bodyweight: e.is_bodyweight,
          muscle_groups: e.muscle_groups,
          default_rest_seconds: e.default_rest_seconds,
          default_cue: e.default_cue,
        }));

        factsBlock = buildFactsBlock({
          today: base.today,
          days_since_last_workout: base.days_since_last_workout,
          detraining: base.detraining,
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
          recovery_required: null, // handled deterministically above; never reached here
          exercise_catalog: catalog,
          equipment: ctx.equipment,
        });

        const allowed = exercises.map((e) => e.name);
        if (allowed.length === 0) return ok({ recommendation: null });
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
        rec = response.output_parsed;
        if (!rec) return ok({ recommendation: null }); // no parseable output → fallback
      }

      // Pin the day's recommendation IMMUTABLY (insert-if-absent). A concurrent
      // first-load that already pinned is ignored — the first composition wins and
      // stays fixed for the day (finding 4). A pin-write failure must not fail the
      // response; worst case is one extra composition on the next load.
      await sb
        .from("daily_recommendations")
        .upsert(
          { rec_date: base.today, payload: rec, prompt_version: RECOMMENDATION_PROMPT_VERSION, facts_block: factsBlock },
          { onConflict: "rec_date", ignoreDuplicates: true },
        );
    }

    return ok({ recommendation: toPayload(rec, ctx.logged_today, exercises), today: toTodayView(base) });
  } catch {
    // Any failure → graceful fallback. If the base facts loaded before the failure
    // (e.g. only the model call failed), still return them so the card renders
    // recency with no header crash; a total failure returns nulls (offline state).
    return ok({ recommendation: null, today: base ? toTodayView(base) : null });
  }
}

/**
 * Assemble the client payload: the pinned recommendation + live remaining counts.
 * Remaining is computed by lib/facts `remainingToday` (recommended sets − logged
 * sets today) against the FIXED pinned target, so it is stable across the day.
 */
function toPayload(
  rec: TodayRecommendation,
  loggedToday: { exercise_id: string }[],
  exercises: { id: string; name: string }[],
): RecommendationPayload {
  const resolved = resolveLiftIds(rec.lifts, exercises);
  const target = resolved
    .filter((l) => l.exercise_id !== null)
    .map((l) => ({ exercise_id: l.exercise_id as string, target_sets: l.target_sets }));
  const remaining = remainingToday(target, loggedToday);
  const byId = new Map(remaining.map((r) => [r.exercise_id, r]));

  const lifts: RecommendationLiftView[] | null =
    rec.lifts === null
      ? null
      : resolved.map((l) => {
          const r = l.exercise_id ? byId.get(l.exercise_id) : undefined;
          return {
            exercise_name: l.exercise_name,
            target_sets: l.target_sets,
            target_reps: l.target_reps,
            target_weight: l.target_weight,
            unit: l.unit,
            rest_seconds: l.rest_seconds,
            cue: l.cue,
            sets_done: r ? r.setsDone : l.target_sets, // absent from `remaining` → complete
            sets_remaining: r ? r.setsRemaining : 0,
          };
        });

  return {
    focus: rec.focus,
    headline: rec.headline,
    reason: rec.reason,
    is_recovery: rec.is_recovery,
    lifts,
    remaining_count: remaining.reduce((sum, r) => sum + r.setsRemaining, 0),
  };
}
