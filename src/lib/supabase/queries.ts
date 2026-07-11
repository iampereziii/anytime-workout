import "server-only";
import { supabaseServer } from "./server";
import { appClockTime, appTimeZone, appToday, toIsoDate } from "@/lib/dates";
import {
  daysSinceLastWorkout,
  isDetraining,
  lastWorkoutRecency,
  muscleGroupRecency,
  nextPrTargets,
  recoveryRecommended,
  sleepStateAmbiguous,
  type MuscleGroupRecency,
  type RecoveryRecommendation,
} from "@/lib/facts";
import type { HistorySession } from "@/lib/openai/prompts";
import type { TodayRecommendation, TodayRecommendationLift } from "@/lib/openai/schemas";
import type { Exercise, PrBest, SessionPart } from "@/types/db";

/**
 * Server-side data gathering shared by /api/recommendation and /api/chat.
 * Everything numeric flows through lib/facts (ADR-0004 / ADR-0007) — this module
 * only fetches rows and shapes them. There is no stored program: the day's
 * recommendation is AI-generated and pinned immutably per calendar day.
 */

export interface TodayContext {
  today: string;
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** The deterministic base facts every consumer needs: today's date + recency. */
export async function getTodayContext(now = appToday()): Promise<TodayContext> {
  const sb = supabaseServer();
  const today = toIsoDate(now);

  const { data: lastSession, error: lastErr } = await sb
    .from("workout_sessions")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIf(lastErr);

  const last_workout_date = lastSession?.date ?? null;
  let days_since = daysSinceLastWorkout(last_workout_date ? [{ date: last_workout_date }] : [], now);

  // Defense-in-depth (timezone-correct-today AC #2): with app-tz "today" a negative
  // recency should be impossible; if one appears it means data-integrity drift (a
  // session dated after the app's today), not a display case. Clamp to 0 and log.
  if (days_since !== null && days_since < 0) {
    console.warn(
      `[data-integrity] days_since_last_workout computed negative (${days_since}): ` +
        `last_workout_date=${last_workout_date} is after app-today=${today}. Clamping to 0.`,
    );
    days_since = 0;
  }

  return {
    today,
    days_since_last_workout: days_since,
    detraining: isDetraining(days_since),
    last_workout_date,
  };
}

export interface ActiveEquipment {
  name: string;
  items: string[];
}

/** A pinned lift with its resolved catalog id (null = the name matched no exercise). */
export interface ResolvedLift extends TodayRecommendationLift {
  exercise_id: string | null;
}

/** Resolve each recommendation lift's exercise_name to its catalog id (exact match —
 *  the composer picks names verbatim from the catalog enum). */
export function resolveLiftIds(
  lifts: TodayRecommendationLift[] | null,
  exercises: Pick<Exercise, "id" | "name">[],
): ResolvedLift[] {
  if (!lifts) return [];
  const idByName = new Map(exercises.map((e) => [e.name, e.id]));
  return lifts.map((l) => ({ ...l, exercise_id: idByName.get(l.exercise_name) ?? null }));
}

/** The day's pinned recommendation (ADR-0007 finding 4 — immutable per rec_date). */
export interface PinnedRecommendation {
  payload: TodayRecommendation;
  prompt_version: number | null;
}

async function getPinnedRecommendation(recDate: string): Promise<PinnedRecommendation | null> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("daily_recommendations")
    .select("payload, prompt_version")
    .eq("rec_date", recDate)
    .maybeSingle();
  if (!data?.payload) return null;
  return { payload: data.payload as TodayRecommendation, prompt_version: data.prompt_version ?? null };
}

type SessionRow = {
  date: string;
  part: SessionPart;
  logged_sets: {
    reps: number;
    weight: number | null;
    logged_at: string;
    exercise: { name: string; unit: string; is_bodyweight: boolean; muscle_groups: string[] } | null;
  }[];
};

/** Exact-time recency facts for the facts block (workout-timing-sleep-state brief). */
export interface TimingFacts {
  /** Current instant on the owner's clock, "yyyy-mm-dd HH:mm" app-tz. */
  now_clock: string;
  /** Hour-granular last-workout line — live-logged sessions only; null = date-only fallback. */
  last_workout: { at: string; hours_since: number } | null;
  /** Computed flag gating the one sleep clarification (day rolled AND gap < 16h). */
  sleep_state_ambiguous: boolean;
}

/**
 * Compute the exact-time facts off the sessions' newest set instants. Hour claims
 * only surface for live-logged sessions (lib/facts `live_logged` guard) — logged_at
 * is entry time, so a backdated entry renders date-only recency, never bogus hours.
 */
function computeTiming(
  instantSessions: { date: string; last_logged_at: string | null }[],
  nowInstant: Date,
): TimingFacts {
  const tz = appTimeZone();
  const rec = lastWorkoutRecency(instantSessions, nowInstant, tz);
  return {
    now_clock: appClockTime(nowInstant, tz),
    last_workout:
      rec && rec.live_logged
        ? { at: appClockTime(new Date(rec.last_logged_at), tz), hours_since: rec.hours_since }
        : null,
    sleep_state_ambiguous: sleepStateAmbiguous(rec, nowInstant, tz),
  };
}

/** Fold session rows into (a) compact history lines and (b) per-session muscle-group unions. */
function shapeSessions(rows: SessionRow[]): {
  history: HistorySession[];
  recencySessions: { date: string; muscle_groups: string[] }[];
  /** Each session's newest set instant — input to `computeTiming`. */
  instantSessions: { date: string; last_logged_at: string | null }[];
} {
  const history: HistorySession[] = rows.map((s) => ({
    date: s.date,
    part: s.part,
    sets: s.logged_sets
      .filter((ls) => ls.exercise !== null)
      .map((ls) => ({
        exercise_name: ls.exercise!.name,
        reps: ls.reps,
        weight: ls.weight,
        unit: ls.exercise!.unit,
        is_bodyweight: ls.exercise!.is_bodyweight,
      })),
  }));
  // Overlap is computed here (ADR-0004), never inferred by the model.
  const recencySessions = rows.map((s) => ({
    date: s.date,
    muscle_groups: [...new Set(s.logged_sets.flatMap((ls) => ls.exercise?.muscle_groups ?? []))],
  }));
  const instantSessions = rows.map((s) => ({
    date: s.date,
    last_logged_at: s.logged_sets.reduce<string | null>(
      (max, ls) => (max === null || Date.parse(ls.logged_at) > Date.parse(max) ? ls.logged_at : max),
      null,
    ),
  }));
  return { history, recencySessions, instantSessions };
}

/** Today's logged sets (exercise_id only) — for the remaining-vs-recommendation count. */
async function getLoggedToday(today: string): Promise<{ exercise_id: string }[]> {
  const sb = supabaseServer();
  const { data: sessions, error: sessErr } = await sb.from("workout_sessions").select("id").eq("date", today);
  throwIf(sessErr);
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length === 0) return [];
  const { data, error } = await sb.from("logged_sets").select("exercise_id").in("session_id", ids);
  throwIf(error);
  return data ?? [];
}

export interface RecommendationContext {
  base: TodayContext;
  muscle_recency: MuscleGroupRecency[];
  recovery: RecoveryRecommendation;
  history: HistorySession[];
  pr_bests: PrBest[];
  next_targets: ReturnType<typeof nextPrTargets>;
  /** Full catalog — the allowed exercises the composer may program (with defaults). */
  exercises: Exercise[];
  equipment: ActiveEquipment | null;
  /** Today's logged sets — subtracted from the pinned target for the remaining count. */
  logged_today: { exercise_id: string }[];
  /** The day's already-pinned recommendation, or null if none composed yet. */
  pinned: PinnedRecommendation | null;
  /** Exact-time recency facts, accurate at compose time (workout-timing-sleep-state brief). */
  timing: TimingFacts;
}

/**
 * Context for GET /api/recommendation (ADR-0007). Provides the raw materials the
 * composer needs (recency, history, PR targets, catalog, equipment) plus the
 * recovery gate, today's logged sets, and any already-pinned recommendation.
 * Everything numeric flows through lib/facts; this only fetches + shapes.
 */
export async function getRecommendationContext(
  now = appToday(),
  nowInstant: Date = new Date(),
): Promise<RecommendationContext> {
  const sb = supabaseServer();
  const base = await getTodayContext(now);

  const [
    { data: sessions, error: sessErr },
    { data: exercises, error: exErr },
    { data: bests, error: bestsErr },
    { data: activeProfile, error: equipErr },
    logged_today,
    pinned,
  ] = await Promise.all([
    sb
      .from("workout_sessions")
      .select(
        "date, part, logged_sets(reps, weight, logged_at, exercise:exercises(name, unit, is_bodyweight, muscle_groups))",
      )
      .order("date", { ascending: false })
      .limit(10),
    sb.from("exercises").select("*").order("name"),
    sb.from("pr_bests").select("*"),
    sb.from("equipment_profiles").select("name, items").eq("is_active", true).maybeSingle(),
    getLoggedToday(base.today),
    getPinnedRecommendation(base.today),
  ]);
  throwIf(sessErr);
  throwIf(exErr);
  throwIf(bestsErr);
  throwIf(equipErr);

  const { history, recencySessions, instantSessions } = shapeSessions((sessions ?? []) as unknown as SessionRow[]);
  const muscle_recency = muscleGroupRecency(recencySessions, now);
  const prBests = (bests ?? []) as PrBest[];
  const allExercises = (exercises ?? []) as Exercise[];

  return {
    base,
    muscle_recency,
    recovery: recoveryRecommended(muscle_recency),
    history,
    pr_bests: prBests,
    next_targets: nextPrTargets(prBests, allExercises),
    exercises: allExercises,
    equipment: activeProfile ? { name: activeProfile.name, items: activeProfile.items } : null,
    logged_today,
    pinned,
    timing: computeTiming(instantSessions, nowInstant),
  };
}

export interface ChatContext extends TodayContext {
  pr_bests: PrBest[];
  next_targets: ReturnType<typeof nextPrTargets>;
  exercises: Exercise[];
  recent_sessions: HistorySession[];
  muscle_recency: MuscleGroupRecency[];
  recovery: RecoveryRecommendation;
  equipment: ActiveEquipment | null;
  /** The day's pinned recommendation, or null — its lifts drive the remaining count
   *  and its headline/reason are injected as the advisory card suggestion. */
  pinned: PinnedRecommendation | null;
  logged_today: { exercise_id: string }[];
  /** Exact-time recency facts — chat is the hour-aware, question-capable surface. */
  timing: TimingFacts;
}

export async function getChatContext(now = appToday(), nowInstant: Date = new Date()): Promise<ChatContext> {
  const sb = supabaseServer();
  const base = await getTodayContext(now);

  const [
    { data: bests, error: bestsErr },
    { data: exercises, error: exErr },
    { data: sessions, error: sessErr },
    { data: activeProfile, error: equipErr },
    logged_today,
    pinned,
  ] = await Promise.all([
    sb.from("pr_bests").select("*"),
    sb.from("exercises").select("*"),
    sb
      .from("workout_sessions")
      .select(
        "date, part, logged_sets(reps, weight, logged_at, exercise:exercises(name, unit, is_bodyweight, muscle_groups))",
      )
      .order("date", { ascending: false })
      .limit(10),
    sb.from("equipment_profiles").select("name, items").eq("is_active", true).maybeSingle(),
    getLoggedToday(base.today),
    getPinnedRecommendation(base.today),
  ]);
  throwIf(bestsErr);
  throwIf(exErr);
  throwIf(sessErr);
  throwIf(equipErr);

  const { history, recencySessions, instantSessions } = shapeSessions((sessions ?? []) as unknown as SessionRow[]);
  const muscle_recency = muscleGroupRecency(recencySessions, now);
  const prBests = (bests ?? []) as PrBest[];
  const allExercises = (exercises ?? []) as Exercise[];

  return {
    ...base,
    pr_bests: prBests,
    next_targets: nextPrTargets(prBests, allExercises),
    exercises: allExercises,
    recent_sessions: history,
    muscle_recency,
    recovery: recoveryRecommended(muscle_recency),
    equipment: activeProfile ? { name: activeProfile.name, items: activeProfile.items } : null,
    pinned,
    logged_today,
    timing: computeTiming(instantSessions, nowInstant),
  };
}
