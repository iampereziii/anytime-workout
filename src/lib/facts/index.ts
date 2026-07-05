/**
 * The deterministic facts layer — the trust core of the app (ADR-0004).
 * Every numeric claim in a recommendation comes from here; the model is
 * instructed to treat this output as ground truth and never recompute.
 *
 * Spec: tests/facts.test.ts (all green).
 *
 * NOTE: originally the owner-written learning scope; AI-implemented 2026-07-05
 * at the owner's request — flagged for a teach-mode revisit.
 */

import type { Exercise, LoggedSet, PlannedExercise, PrBest, WorkoutSession } from "@/types/db";

/** Local-midnight Date from an ISO date string (yyyy-mm-dd) — date-only semantics. */
function atLocalMidnight(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Days between the most recent session date and today. Null when no history (Flow 4). */
export function daysSinceLastWorkout(
  sessions: Pick<WorkoutSession, "date">[],
  today: Date,
): number | null {
  if (sessions.length === 0) return null;
  // ISO dates sort lexicographically — max string = most recent.
  const last = sessions.reduce((max, s) => (s.date > max ? s.date : max), sessions[0].date);
  const lastMid = atLocalMidnight(last);
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Math.round absorbs DST hour shifts inside the difference.
  return Math.round((todayMid.getTime() - lastMid.getTime()) / 86_400_000);
}

/** Detraining mode: gap of 14+ days (business rule 6 / Flow 6). No history is NOT detraining. */
export function isDetraining(daysSince: number | null): boolean {
  return daysSince !== null && daysSince >= 14;
}

export interface RemainingExercise {
  planned: PlannedExercise;
  setsDone: number;
  setsRemaining: number;
}

/**
 * What's left of today's program day, across AM/PM mini-sessions (Flow 7).
 * A planned exercise is "remaining" while setsDone < target_sets. Ad-hoc sets
 * for exercises not in the plan (Flow 9) are ignored here.
 */
export function remainingToday(
  planned: PlannedExercise[],
  loggedToday: Pick<LoggedSet, "exercise_id">[],
): RemainingExercise[] {
  const done = new Map<string, number>();
  for (const set of loggedToday) {
    done.set(set.exercise_id, (done.get(set.exercise_id) ?? 0) + 1);
  }
  return [...planned]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => {
      const setsDone = done.get(p.exercise_id) ?? 0;
      return { planned: p, setsDone, setsRemaining: Math.max(0, p.target_sets - setsDone) };
    })
    .filter((r) => r.setsRemaining > 0);
}

export interface NewPr {
  exercise_id: string;
  reps: number;
  weight: number | null;
  previous: { reps: number; weight: number | null };
  /** Which axis beat the record: load for weighted movements, volume for bodyweight. */
  rule_applied: "weight" | "reps";
}

type SetLike = Pick<LoggedSet, "exercise_id" | "reps" | "weight">;

/**
 * Does candidate beat incumbent under the pr_bests view's exact ordering
 * (business rule 3)? Weighted: weight first, reps tie-break; bodyweight:
 * reps first, added-weight tie-break. NULL weight ranks as 0, like the view.
 */
function beats(
  candidate: SetLike,
  incumbent: { reps: number; weight: number | null },
  isBodyweight: boolean,
): boolean {
  const cw = candidate.weight ?? 0;
  const iw = incumbent.weight ?? 0;
  if (isBodyweight) {
    return candidate.reps > incumbent.reps || (candidate.reps === incumbent.reps && cw > iw);
  }
  return cw > iw || (cw === iw && candidate.reps > incumbent.reps);
}

/**
 * New-PR detection for a confirmed save (feature brief: pr-celebration-on-new-best).
 * Compare incoming sets against the PRE-save bests, per variation. At most one
 * entry per exercise (the best of the batch). No prior best → no celebration —
 * a first-ever log is a baseline, not a record broken.
 */
export function detectNewPrs(
  bests: PrBest[],
  sets: SetLike[],
  exercises: Pick<Exercise, "id" | "is_bodyweight">[],
): NewPr[] {
  const bestById = new Map(bests.map((b) => [b.exercise_id, b]));
  const bwById = new Map(exercises.map((e) => [e.id, e.is_bodyweight]));

  const winners = new Map<string, NewPr>();
  for (const set of sets) {
    const best = bestById.get(set.exercise_id);
    if (!best) continue;
    const isBodyweight = bwById.get(set.exercise_id) ?? best.is_bodyweight;

    const incumbent = winners.get(set.exercise_id) ?? { reps: best.best_reps, weight: best.best_weight };
    if (!beats(set, incumbent, isBodyweight)) continue;

    winners.set(set.exercise_id, {
      exercise_id: set.exercise_id,
      reps: set.reps,
      weight: set.weight,
      previous: { reps: best.best_reps, weight: best.best_weight },
      rule_applied: isBodyweight ? "reps" : "weight",
    });
  }
  return [...winners.values()];
}

export interface NextPrTarget {
  exercise_id: string;
  target_reps: number;
  target_weight: number | null;
  rule_applied: "add_weight" | "add_reps";
}

/**
 * Next-PR targets from current bests (Flow 8), minimum overload increments:
 *  - Weighted movement (not bodyweight, has a load): same reps, +2.5 lbs.
 *  - Bodyweight / no load (incl. duration units like plank-seconds): +1 rep/second,
 *    any added load unchanged.
 */
export function nextPrTargets(bests: PrBest[], exercises: Exercise[]): NextPrTarget[] {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  return bests.map((best) => {
    const isBodyweight = byId.get(best.exercise_id)?.is_bodyweight ?? best.is_bodyweight;
    const weighted = !isBodyweight && best.best_weight !== null;
    return weighted
      ? {
          exercise_id: best.exercise_id,
          target_reps: best.best_reps,
          target_weight: (best.best_weight as number) + 2.5,
          rule_applied: "add_weight" as const,
        }
      : {
          exercise_id: best.exercise_id,
          target_reps: best.best_reps + 1,
          target_weight: best.best_weight,
          rule_applied: "add_reps" as const,
        };
  });
}
