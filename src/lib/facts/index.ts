/**
 * The deterministic facts layer — the trust core of the app (ADR-0004, amended by
 * ADR-0007). The model now ORIGINATES the workout (focus + lifts + sets + reps +
 * weight); the two safety-critical signals that stay deterministic live here and
 * are fed to the model as hard facts it composes around but cannot silently
 * override: progressive-overload targets (`nextPrTargets`, off pr_bests +
 * exercises) and the recovery-readiness gate (`recoveryRecommended`, off
 * session-derived muscle recency over PARENT_GROUPS). Neither needs the retired
 * program tables. Date math and remaining-count also stay here (never the model).
 *
 * Spec: tests/facts.test.ts (all green).
 *
 * NOTE: originally the owner-written learning scope; AI-implemented 2026-07-05
 * at the owner's request — flagged for a teach-mode revisit.
 */

import { PARENT_GROUPS, withParents } from "@/lib/muscle-groups";
import type { Exercise, LoggedSet, PrBest, WorkoutSession } from "@/types/db";

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

export interface MuscleGroupRecency {
  muscle_group: string;
  days_since: number;
  last_trained_on: string; // yyyy-mm-dd
}

/**
 * Per-muscle-group recency for adaptive readjustment (feature brief Risk #1).
 * Overlap is computed here, NOT inferred by the model (ADR-0004): given recent
 * sessions each carrying the union of muscle groups trained that day, return the
 * days since each group was last worked, soonest-trained first.
 *
 * Two-level roll-up (recency-first brief, AC #2): each session's tags are
 * expanded with their parents (`withParents`) before folding, so training a
 * sub-group (`chest_upper`) also refreshes its parent (`chest`). Recency is
 * therefore reported at BOTH levels — a coarse hit never goes blind.
 *
 * Sessions may arrive unsorted; the most recent date per group wins. Groups never
 * trained in the window simply don't appear.
 */
export function muscleGroupRecency(
  sessions: { date: string; muscle_groups: string[] }[],
  today: Date,
): MuscleGroupRecency[] {
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const latest = new Map<string, string>(); // muscle group -> most recent ISO date
  for (const s of sessions) {
    for (const g of withParents(s.muscle_groups)) {
      const cur = latest.get(g);
      if (!cur || s.date > cur) latest.set(g, s.date); // ISO dates compare lexicographically
    }
  }
  return [...latest.entries()]
    .map(([muscle_group, date]) => ({
      muscle_group,
      last_trained_on: date,
      // Math.round absorbs DST hour shifts, matching daysSinceLastWorkout.
      days_since: Math.round((todayMid.getTime() - atLocalMidnight(date).getTime()) / 86_400_000),
    }))
    .sort((a, b) => a.days_since - b.days_since || a.muscle_group.localeCompare(b.muscle_group));
}

export interface RecoveryRecommendation {
  /** True → the app FORCES a recovery/rest recommendation (hard fact to the model). */
  recommended: boolean;
  /** Human-readable computed reason when forced; null otherwise. */
  reason: string | null;
}

/**
 * Recovery-readiness gate (ADR-0007 finding 2) — the re-homed 2026-07-07 incident
 * guardrail. Originally coded against `program_days`' focus menu, its real input
 * was always session-derived muscle recency over PARENT_GROUPS; neither is dropped,
 * so it is re-homed here as a deterministic fact rather than handed to the model
 * whose judgment it exists to backstop.
 *
 * A parent group is "recovered enough to anchor a workout" when it was trained 2+
 * days ago OR never trained in the recency window (cold/fresh). Recovery is FORCED
 * only when NO parent group qualifies — i.e. every one of the 10 parents was
 * trained <=1 day ago. Strict and conservative by design: it fires only at true
 * full-body exhaustion (the incident shape), and never suppresses training while a
 * genuinely fresh muscle group exists. In softer cases the model still receives
 * full muscle recency and picks the fresh muscles itself.
 */
export function recoveryRecommended(recency: MuscleGroupRecency[]): RecoveryRecommendation {
  const daysByGroup = new Map(recency.map((r) => [r.muscle_group, r.days_since]));
  const anyRecovered = PARENT_GROUPS.some((g) => {
    const d = daysByGroup.get(g);
    return d === undefined || d >= 2; // cold (never in window) or rested
  });
  if (anyRecovered) return { recommended: false, reason: null };
  return {
    recommended: true,
    reason:
      "every muscle group was trained within the last day — recommend rest or active recovery, never a training focus that overlaps recovering muscles",
  };
}

export interface RemainingExercise {
  exercise_id: string;
  target_sets: number;
  setsDone: number;
  setsRemaining: number;
}

/**
 * What's left of the day's recommended workout, across AM/PM mini-sessions (Flow 7,
 * amended by ADR-0007). "Remaining" re-derives against the DAY'S RECOMMENDATION
 * (recommended sets − logged sets) instead of a stored plan. The target is the
 * immutable per-day recommendation pinned by the recommendation route (finding 4),
 * so this count is stable across the day regardless of a shifting fingerprint. An
 * exercise is "remaining" while setsDone < target_sets; ad-hoc sets for exercises
 * not in the recommendation (Flow 9) are ignored. Input order is preserved.
 */
export function remainingToday(
  target: { exercise_id: string; target_sets: number }[],
  loggedToday: Pick<LoggedSet, "exercise_id">[],
): RemainingExercise[] {
  const done = new Map<string, number>();
  for (const set of loggedToday) {
    done.set(set.exercise_id, (done.get(set.exercise_id) ?? 0) + 1);
  }
  return target
    .map((t) => {
      const setsDone = done.get(t.exercise_id) ?? 0;
      return {
        exercise_id: t.exercise_id,
        target_sets: t.target_sets,
        setsDone,
        setsRemaining: Math.max(0, t.target_sets - setsDone),
      };
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
 *
 * Stays deterministic under ADR-0007 (finding 1): depends on neither dropped table
 * (pr_bests + exercises only), so progression remains a tested pure function fed to
 * the composer as the hard progression anchor the model must respect.
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
