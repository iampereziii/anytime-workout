/**
 * The deterministic facts layer — the trust core of the app (ADR-0004, amended by
 * ADR-0007). The model now ORIGINATES the workout (focus + lifts + sets + reps +
 * weight); the safety-critical signal that stays deterministic lives here and is
 * fed to the model as hard facts it composes around but cannot silently override:
 * progressive-overload targets (`nextPrTargets`, off pr_bests + exercises). Date
 * math also stays here (never the model). Recovery readiness is NO LONGER a
 * deterministic gate — retired to model judgment per ADR-0008; the model reasons
 * about rest from the computed muscle-recency facts below.
 *
 * `remainingToday` was retired by ADR-0009: the recommendation is a static
 * suggestion, so there is no "recommended sets − logged sets" derivation left to
 * compute. Logging changes history and PRs; it never changes the card.
 *
 * Spec: tests/facts.test.ts (all green).
 *
 * NOTE: originally the owner-written learning scope; AI-implemented 2026-07-05
 * at the owner's request — flagged for a teach-mode revisit.
 */

import { appTodayIso } from "@/lib/dates";
import { withParents } from "@/lib/muscle-groups";
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

/**
 * Sleep-ambiguity ceiling (workout-timing-sleep-state brief, Risk #2): a gap that
 * crosses midnight but is shorter than a typical waking block (~16-17h) may or may
 * not contain sleep — the one recovery fact the app cannot compute. Gaps >= this
 * that cross midnight almost certainly contain sleep; same-day gaps never fire.
 * Tunable in one line; the truth-table test pins the boundary.
 */
export const SLEEP_AMBIGUITY_MAX_HOURS = 16;

export interface LastWorkoutRecency {
  /** ISO instant of the newest logged set (logged_sets.logged_at). */
  last_logged_at: string;
  /** The owning session's calendar date (yyyy-mm-dd). */
  session_date: string;
  /** Whole hours elapsed (floored, clamped >= 0) — computed here, never by the model. */
  hours_since: number;
  /**
   * True when the session was logged live: its date equals the app-tz calendar date
   * of its logged_at. logged_at records ENTRY time, not performance time, so hour
   * granularity is only trustworthy for live logs — backdated entries must fall
   * back to date-only recency (brief Risk #1).
   */
  live_logged: boolean;
}

/**
 * Hour-granular last-workout recency (workout-timing-sleep-state brief). Given each
 * recent session's newest set instant, return the overall newest with elapsed hours.
 * Pure: instants and tz injected, no hidden clock. Null when no session carries a
 * timestamp (no history, or rows predating logged_at capture).
 */
export function lastWorkoutRecency(
  sessions: { date: string; last_logged_at: string | null }[],
  now: Date,
  tz: string,
): LastWorkoutRecency | null {
  let newest: { date: string; last_logged_at: string } | null = null;
  for (const s of sessions) {
    if (s.last_logged_at === null) continue;
    // ISO-8601 instants from Postgres compare lexicographically within the same offset,
    // but offsets can vary — compare as epoch millis to be safe.
    if (!newest || Date.parse(s.last_logged_at) > Date.parse(newest.last_logged_at)) {
      newest = { date: s.date, last_logged_at: s.last_logged_at };
    }
  }
  if (!newest) return null;

  const elapsedMs = now.getTime() - Date.parse(newest.last_logged_at);
  return {
    last_logged_at: newest.last_logged_at,
    session_date: newest.date,
    // Clamp: a future logged_at means clock skew / data drift, not negative recency.
    hours_since: Math.max(0, Math.floor(elapsedMs / 3_600_000)),
    live_logged: newest.date === appTodayIso(new Date(newest.last_logged_at), tz),
  };
}

/**
 * The deterministic gate on the one clarifying question (brief: "never assume").
 * True only when the app-tz calendar day has rolled since the last workout AND the
 * elapsed gap is under SLEEP_AMBIGUITY_MAX_HOURS — i.e. "new day" is on the record
 * but sleep is genuinely unknowable. Backdated sessions never fire (their instant
 * is entry time, not performance time); same-day gaps never fire (no day roll, no
 * sleep assumption to get wrong). The model composes the question; code decides
 * WHEN asking is warranted (ADR-0004: if it's computable, compute it).
 */
export function sleepStateAmbiguous(rec: LastWorkoutRecency | null, now: Date, tz: string): boolean {
  if (!rec || !rec.live_logged) return false;
  const dayRolled = appTodayIso(new Date(rec.last_logged_at), tz) !== appTodayIso(now, tz);
  return dayRolled && rec.hours_since < SLEEP_AMBIGUITY_MAX_HOURS;
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
