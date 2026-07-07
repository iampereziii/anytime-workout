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

import { PARENT_GROUPS, withParents } from "@/lib/muscle-groups";
import { RECOMMENDATION_PROMPT_VERSION } from "@/lib/openai/prompts";
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

export interface FocusGroupRecency {
  muscle_group: string;
  /** Days since this group was last trained; null = not trained in the recency window (cold). */
  days_since: number | null;
}

export interface FocusRecency {
  label: string;
  /** This focus's muscle groups at BOTH levels (sub-groups + rolled-up parents),
   *  soonest-trained first, cold groups last. */
  groups: FocusGroupRecency[];
  /** Min days-since among this focus's trained groups — how recently ANY muscle it
   *  hits was worked. Higher = staler focus = better pick. null = none of its groups
   *  were trained in the window (fully cold). */
  freshest_overlap_days: number | null;
}

/**
 * Per-focus overlap facts (recency-first brief). For each program-day LABEL,
 * take the union of muscle groups its planned lifts train, expand to both levels
 * (`withParents`), and attach each group's computed days-since from
 * `muscleGroupRecency`. `freshest_overlap_days` is the min days-since among the
 * trained groups — the freshness-first signal the model picks on (larger = the
 * focus's muscles are all colder = the better call). This is the fact ADR-0004
 * says must be computed, not left to the model to infer from a label like
 * "Full Body — Power Day".
 *
 * Days that repeat a label are unioned (one focus = one row). An all-cardio /
 * untagged day contributes no groups and yields `freshest_overlap_days: null`
 * (fully cold) without crashing.
 */
export function focusRecency(
  days: { label: string; muscle_groups: string[] }[],
  recency: MuscleGroupRecency[],
): FocusRecency[] {
  const daysSinceByGroup = new Map(recency.map((r) => [r.muscle_group, r.days_since]));

  // Union each label's groups across day_numbers, preserving first-seen order.
  const order: string[] = [];
  const byLabel = new Map<string, Set<string>>();
  for (const d of days) {
    let set = byLabel.get(d.label);
    if (!set) {
      set = new Set<string>();
      byLabel.set(d.label, set);
      order.push(d.label);
    }
    for (const g of withParents(d.muscle_groups)) set.add(g);
  }

  return order.map((label) => {
    const groups: FocusGroupRecency[] = [...byLabel.get(label)!]
      .map((g) => ({ muscle_group: g, days_since: daysSinceByGroup.get(g) ?? null }))
      // soonest-trained first; cold (null) sinks to the bottom; ties alphabetical.
      .sort((a, b) => {
        if (a.days_since === null && b.days_since === null) return a.muscle_group.localeCompare(b.muscle_group);
        if (a.days_since === null) return 1;
        if (b.days_since === null) return -1;
        return a.days_since - b.days_since || a.muscle_group.localeCompare(b.muscle_group);
      });
    const trained = groups.filter((g) => g.days_since !== null).map((g) => g.days_since as number);
    return {
      label,
      groups,
      freshest_overlap_days: trained.length ? Math.min(...trained) : null,
    };
  });
}

export interface CandidateRecommendation {
  label: string;
  /** Advisory 0–100 heuristic score — NOT ground truth. The prompts tell the
   *  model it may pick any candidate the facts support better. */
  score: number;
  /** Human-readable computed reasons (parent-level recency / recent-load counts)
   *  — every figure comes from the same computed facts, never invented. */
  reasons: string[];
}

/**
 * Scored candidate recommendations (coaching-judgment brief follow-up).
 * Instead of the model receiving one pre-picked card, the RULES side scores
 * every focus (ADR-0004: the scoring is deterministic and testable here) and
 * both the Today-card composer and chat receive the full ranked list. The
 * scores are explicitly ADVISORY — the prompts instruct the model to choose
 * the candidate best supported by the facts, not necessarily the top score.
 *
 * Heuristic (documented so a surprising card is explainable from the row):
 *  - Training focus (has tagged groups): recovery (0–55) from
 *    `freshest_overlap_days` per the recovery rules (0–1d not recovered,
 *    2d workable, 3+d/cold recovered) + staleness (0–35) from the average
 *    days-since across its groups (cold counts as 7, each capped at 7) +
 *    a +5 calendar tie-break for today's scheduled label.
 *  - Recovery-type focus (no tagged groups — Rest / Active Recovery /
 *    Conditioning): scales with distinct training days in the last 3 days,
 *    and jumps to at least 92 when NO training focus is recovered (every
 *    option overlaps muscles trained ≤1 day ago) — the 2026-07-07 incident
 *    guardrail baked into the numbers, not just the prompt text.
 * Sorted best-first; ties break alphabetically for determinism.
 */
export function candidateRecommendations(
  focuses: FocusRecency[],
  sessionDates: string[],
  today: string, // yyyy-mm-dd (app-tz), same value rendered as "Today:" in the facts block
  calendarLabel: string | null,
): CandidateRecommendation[] {
  const todayMid = atLocalMidnight(today);
  const daysAgo = (date: string) => Math.round((todayMid.getTime() - atLocalMidnight(date).getTime()) / 86_400_000);
  const trainingDaysLast3 = new Set(sessionDates.filter((d) => daysAgo(d) >= 0 && daysAgo(d) <= 2)).size;

  const training = focuses.filter((f) => f.groups.length > 0);
  const nothingRecovered =
    training.length > 0 && training.every((f) => f.freshest_overlap_days !== null && f.freshest_overlap_days <= 1);

  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const scored = focuses.map((f): CandidateRecommendation => {
    if (f.groups.length === 0) {
      // Recovery-type focus: worth more the harder the last 3 days were.
      const reasons = [`${trainingDaysLast3} training day${trainingDaysLast3 === 1 ? "" : "s"} in the last 3 days`];
      let score = 25 + 20 * Math.min(3, trainingDaysLast3);
      if (nothingRecovered) {
        score = Math.max(score, 92);
        reasons.push("no focus is recovered — every training option overlaps muscles trained <=1 day ago");
      }
      return { label: f.label, score: clamp(score), reasons };
    }

    const fo = f.freshest_overlap_days;
    // Recovery: how ready this focus's MOST recently trained muscle is.
    const recovery = fo === null ? 55 : fo <= 1 ? 10 + 5 * fo : fo === 2 ? 40 : 55;
    // Staleness: rewards the least-recently-trained option among recovered ones.
    const capped = f.groups.map((g) => Math.min(7, g.days_since ?? 7));
    const staleness = Math.round((capped.reduce((a, b) => a + b, 0) / capped.length) * 5);
    const calendar = f.label === calendarLabel ? 5 : 0;

    // Reasons at parent level only — the both-levels detail already lives in the
    // Focus options facts; the candidate line stays scannable.
    const parents = f.groups.filter((g) => (PARENT_GROUPS as readonly string[]).includes(g.muscle_group));
    const reasons = (parents.length > 0 ? parents : f.groups).map(
      (g) => `${g.muscle_group} ${g.days_since === null ? "cold" : `${g.days_since}d`}`,
    );
    return { label: f.label, score: clamp(recovery + staleness + calendar), reasons };
  });

  return scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/**
 * Cache key for the Today recommendation (feature brief: ai-today-recommendation,
 * Risk #2). The recommendation is a function of three things that change it:
 * the calendar day (rolls at midnight), the latest logged session (a new log
 * inserts a new workout_sessions row), and the composer prompt's behavioral
 * version (a deploy that changes the coaching regime must not keep serving the
 * old regime's cached card — coaching-judgment brief, Risk #3). Fingerprinting
 * all three means a new log, a date rollover, OR a prompt-regime deploy is a
 * natural cache miss — no invalidation hook needed. Same fingerprint on a
 * reload → cache hit → zero model calls (AC #4).
 */
export function recommendationFingerprint(today: string, latestSessionId: string | null): string {
  return `${today}:${latestSessionId ?? "none"}:p${RECOMMENDATION_PROMPT_VERSION}`;
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
