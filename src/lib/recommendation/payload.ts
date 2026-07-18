import type { TodayContext } from "@/lib/supabase/queries";
import type { TodayRecommendation } from "@/lib/openai/schemas";

/**
 * The shape GET /api/recommendation and POST /api/recommendation/new both return —
 * one definition so the two can't drift apart.
 *
 * ADR-0009: this is a STATIC suggestion. The payload carries the composed targets
 * and nothing about progress against them — no `remaining_count`, no per-lift
 * `sets_done`/`sets_remaining`. Logging a set changes history and PRs; it does not
 * change anything here. There is no per-day state at all: the day's only inputs are
 * the pin and the calendar.
 */

export interface RecommendationLiftView {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
  rest_seconds: number | null;
  cue: string | null;
}

export interface RecommendationPayload {
  focus: string;
  headline: string;
  reason: string;
  is_recovery: boolean;
  /** The composed workout as suggested, or null on a recovery day. */
  lifts: RecommendationLiftView[] | null;
}

/** Deterministic base facts — always returned (even when the AI composition fails)
 *  so the card can render recency without a broken header. */
export interface TodayView {
  date: string;
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

export function toTodayView(base: TodayContext): TodayView {
  return {
    date: base.today,
    days_since_last_workout: base.days_since_last_workout,
    detraining: base.detraining,
    last_workout_date: base.last_workout_date,
  };
}

/**
 * Assemble the client payload from the pinned recommendation. A straight projection:
 * with remaining retired there is no logged-set input and no exercise-id resolution
 * left to do — the composer already names its lifts verbatim from the catalog.
 */
export function toPayload(rec: TodayRecommendation): RecommendationPayload {
  return {
    focus: rec.focus,
    headline: rec.headline,
    reason: rec.reason,
    is_recovery: rec.is_recovery,
    lifts:
      rec.lifts?.map((l) => ({
        exercise_name: l.exercise_name,
        target_sets: l.target_sets,
        target_reps: l.target_reps,
        target_weight: l.target_weight,
        unit: l.unit,
        rest_seconds: l.rest_seconds,
        cue: l.cue,
      })) ?? null,
  };
}
