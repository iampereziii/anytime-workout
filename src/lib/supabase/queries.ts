import "server-only";
import { supabaseServer } from "./server";
import { appToday, dayNumberFor, toIsoDate } from "@/lib/dates";
import {
  daysSinceLastWorkout,
  isDetraining,
  muscleGroupRecency,
  nextPrTargets,
  recommendationFingerprint,
  remainingToday,
  type MuscleGroupRecency,
  type RemainingExercise,
} from "@/lib/facts";
import type { HistorySession } from "@/lib/openai/prompts";
import type { Exercise, PlannedExercise, PrBest, ProgramDay, SessionPart } from "@/types/db";

/**
 * Server-side data gathering shared by /api/program/today and /api/chat.
 * Everything numeric flows through lib/facts (ADR-0004) — this module only
 * fetches rows and shapes them.
 */

export interface PlannedWithExercise extends PlannedExercise {
  exercise: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">;
}

export interface TodayContext {
  today: string;
  day_number: number;
  day: Pick<ProgramDay, "id" | "label" | "notes"> | null;
  planned: PlannedWithExercise[];
  remaining: RemainingExercise[];
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function getTodayContext(now = appToday()): Promise<TodayContext> {
  const sb = supabaseServer();
  const today = toIsoDate(now);
  const day_number = dayNumberFor(now);

  const [{ data: day, error: dayErr }, { data: lastSession, error: lastErr }, { data: todaySessions, error: sessErr }] =
    await Promise.all([
      sb
        .from("program_days")
        .select("id, label, notes, programs!inner(is_active)")
        .eq("day_number", day_number)
        .eq("programs.is_active", true)
        .maybeSingle(),
      sb.from("workout_sessions").select("date").order("date", { ascending: false }).limit(1).maybeSingle(),
      sb.from("workout_sessions").select("id").eq("date", today),
    ]);
  throwIf(dayErr);
  throwIf(lastErr);
  throwIf(sessErr);

  let planned: PlannedWithExercise[] = [];
  if (day) {
    const { data, error } = await sb
      .from("planned_exercises")
      .select("*, exercise:exercises(id, name, unit, is_bodyweight)")
      .eq("program_day_id", day.id)
      .order("sort_order");
    throwIf(error);
    planned = (data ?? []) as unknown as PlannedWithExercise[];
  }

  let loggedTodaySets: { exercise_id: string }[] = [];
  const sessionIds = (todaySessions ?? []).map((s) => s.id);
  if (sessionIds.length > 0) {
    const { data, error } = await sb.from("logged_sets").select("exercise_id").in("session_id", sessionIds);
    throwIf(error);
    loggedTodaySets = data ?? [];
  }

  const last_workout_date = lastSession?.date ?? null;
  let days_since = daysSinceLastWorkout(last_workout_date ? [{ date: last_workout_date }] : [], now);

  // Defense-in-depth (feature brief AC #2): with app-tz "today" a negative recency
  // should be impossible; if one appears it means data-integrity drift (a session
  // dated after the app's today), not a display case. Clamp to 0 and log — never
  // surface a negative to any consumer.
  if (days_since !== null && days_since < 0) {
    console.warn(
      `[data-integrity] days_since_last_workout computed negative (${days_since}): ` +
        `last_workout_date=${last_workout_date} is after app-today=${today}. Clamping to 0.`,
    );
    days_since = 0;
  }

  return {
    today,
    day_number,
    day: day ? { id: day.id, label: day.label, notes: day.notes } : null,
    planned,
    remaining: remainingToday(planned, loggedTodaySets),
    days_since_last_workout: days_since,
    detraining: isDetraining(days_since),
    last_workout_date,
  };
}

export interface ActiveEquipment {
  name: string;
  items: string[];
}

export interface ChatContext extends TodayContext {
  pr_bests: PrBest[];
  next_targets: ReturnType<typeof nextPrTargets>;
  exercises: Exercise[];
  recent_sessions: {
    date: string;
    part: SessionPart;
    sets: { exercise_name: string; reps: number; weight: number | null; unit: string; is_bodyweight: boolean }[];
  }[];
  /** Per-muscle-group recency for adaptive readjustment (computed, ADR-0004). */
  muscle_recency: MuscleGroupRecency[];
  /** The active equipment profile — context for equipment-aware adaptation (null if none). */
  equipment: ActiveEquipment | null;
  /** Program-day labels + muscle-group unions — feeds focusRecency so chat shares
   *  the card's per-focus overlap facts (card/chat consistency, recency-first brief). */
  program_days: Pick<ProgramDayCatalogEntry, "label" | "muscle_groups">[];
  /** Today's cached card suggestion for the CURRENT fingerprint, or null if none
   *  has been composed yet — injected into chat so it can't contradict the card. */
  card_suggestion: { headline: string; reason: string } | null;
}

export interface SuggestedLift {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
  sort_order: number;
}

export interface ProgramDayCatalogEntry {
  day_number: number;
  label: string;
  notes: string | null;
  planned: SuggestedLift[];
  /** Union of muscle groups this day's planned lifts train (as-tagged; roll-up to
   *  parents happens in lib/facts). Feeds per-focus overlap facts (ADR-0004). */
  muscle_groups: string[];
}

export interface RecommendationContext {
  base: TodayContext;
  /** Per-muscle-group recency for the recommendation reason (computed, ADR-0004). */
  muscle_recency: MuscleGroupRecency[];
  /** Every day of the active program + its planned lifts — the allowed focuses
   *  (distinct labels) and the source for "Suggested lifts" on divergence. */
  program_days: ProgramDayCatalogEntry[];
  /** Latest logged session id — half of the cache fingerprint (Risk #2). */
  latest_session_id: string | null;
  /** Compact history lines for the prompt (most recent first). */
  history: HistorySession[];
}

/**
 * Context for GET /api/recommendation (feature brief: ai-today-recommendation).
 * Reuses getTodayContext for the deterministic today facts, then adds per-group
 * recency, the full program-day catalog (allowed focuses + suggested-lifts
 * lookup), and the latest session id for the cache fingerprint. Everything
 * numeric still flows through lib/facts (ADR-0004); this only fetches + shapes.
 */
export async function getRecommendationContext(now = appToday()): Promise<RecommendationContext> {
  const sb = supabaseServer();
  const base = await getTodayContext(now);

  const [
    { data: sessions, error: sessErr },
    { data: days, error: daysErr },
    { data: latest, error: latestErr },
  ] = await Promise.all([
    sb
      .from("workout_sessions")
      .select("id, date, part, logged_sets(reps, weight, exercise:exercises(name, unit, is_bodyweight, muscle_groups))")
      .order("date", { ascending: false })
      .limit(10),
    sb
      .from("program_days")
      .select(
        "day_number, label, notes, programs!inner(is_active), planned_exercises(target_sets, target_reps, target_weight, sort_order, exercise:exercises(name, unit, muscle_groups))",
      )
      .eq("programs.is_active", true)
      .order("day_number"),
    sb.from("workout_sessions").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  throwIf(sessErr);
  throwIf(daysErr);
  throwIf(latestErr);

  type SessionRow = {
    date: string;
    part: SessionPart;
    logged_sets: {
      reps: number;
      weight: number | null;
      exercise: { name: string; unit: string; is_bodyweight: boolean; muscle_groups: string[] } | null;
    }[];
  };
  const sessionRows = (sessions ?? []) as unknown as SessionRow[];

  // Fold each session into the union of muscle groups it trained. Overlap is
  // computed here (ADR-0004), never inferred by the model.
  const recencySessions = sessionRows.map((s) => ({
    date: s.date,
    muscle_groups: [...new Set(s.logged_sets.flatMap((ls) => ls.exercise?.muscle_groups ?? []))],
  }));

  const history: HistorySession[] = sessionRows.map((s) => ({
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

  type DayRow = {
    day_number: number;
    label: string;
    notes: string | null;
    planned_exercises: {
      target_sets: number;
      target_reps: number | null;
      target_weight: number | null;
      sort_order: number;
      exercise: { name: string; unit: string; muscle_groups: string[] } | null;
    }[];
  };
  const program_days: ProgramDayCatalogEntry[] = ((days ?? []) as unknown as DayRow[]).map((d) => ({
    day_number: d.day_number,
    label: d.label,
    notes: d.notes,
    planned: d.planned_exercises
      .filter((p) => p.exercise !== null)
      .map((p) => ({
        exercise_name: p.exercise!.name,
        target_sets: p.target_sets,
        target_reps: p.target_reps,
        target_weight: p.target_weight,
        unit: p.exercise!.unit,
        sort_order: p.sort_order,
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
    // Union over the day's planned lifts (as-tagged; lib/facts rolls up to parents).
    muscle_groups: [...new Set(d.planned_exercises.flatMap((p) => p.exercise?.muscle_groups ?? []))],
  }));

  return {
    base,
    muscle_recency: muscleGroupRecency(recencySessions, now),
    program_days,
    latest_session_id: latest?.id ?? null,
    history,
  };
}

export async function getChatContext(now = appToday()): Promise<ChatContext> {
  const sb = supabaseServer();
  const base = await getTodayContext(now);

  const [
    { data: bests, error: bestsErr },
    { data: exercises, error: exErr },
    { data: sessions, error: sessErr },
    { data: activeProfile, error: equipErr },
    { data: days, error: daysErr },
    { data: latest, error: latestErr },
  ] = await Promise.all([
    sb.from("pr_bests").select("*"),
    sb.from("exercises").select("*"),
    sb
      .from("workout_sessions")
      .select("id, date, part, logged_sets(reps, weight, exercise:exercises(name, unit, is_bodyweight))")
      .order("date", { ascending: false })
      .limit(10),
    sb.from("equipment_profiles").select("name, items").eq("is_active", true).maybeSingle(),
    sb
      .from("program_days")
      .select("label, programs!inner(is_active), planned_exercises(exercise:exercises(muscle_groups))")
      .eq("programs.is_active", true)
      .order("day_number"),
    sb.from("workout_sessions").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  throwIf(bestsErr);
  throwIf(exErr);
  throwIf(sessErr);
  throwIf(equipErr);
  throwIf(daysErr);
  throwIf(latestErr);

  // The card the owner is looking at right now = the cache row for the CURRENT
  // fingerprint (same key /api/recommendation reads). Absent row → no card yet;
  // chat just goes without it. Best-effort: a read failure must not break chat.
  const fingerprint = recommendationFingerprint(base.today, latest?.id ?? null);
  const { data: cachedCard } = await sb
    .from("daily_recommendations")
    .select("payload")
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  const cardPayload = (cachedCard?.payload ?? null) as { headline?: string; reason?: string } | null;
  const card_suggestion =
    cardPayload?.headline && cardPayload?.reason ? { headline: cardPayload.headline, reason: cardPayload.reason } : null;

  type ChatDayRow = { label: string; planned_exercises: { exercise: { muscle_groups: string[] } | null }[] };
  const program_days = ((days ?? []) as unknown as ChatDayRow[]).map((d) => ({
    label: d.label,
    // Union over the day's planned lifts (as-tagged; lib/facts rolls up to parents).
    muscle_groups: [...new Set(d.planned_exercises.flatMap((p) => p.exercise?.muscle_groups ?? []))],
  }));

  type SessionRow = {
    id: string;
    date: string;
    part: SessionPart;
    logged_sets: {
      reps: number;
      weight: number | null;
      exercise: { name: string; unit: string; is_bodyweight: boolean } | null;
    }[];
  };

  const recent_sessions = ((sessions ?? []) as unknown as SessionRow[]).map((s) => ({
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

  const prBests = (bests ?? []) as PrBest[];
  const allExercises = (exercises ?? []) as Exercise[];

  // Map canonical name -> muscle groups, then fold each recent session into the
  // union of groups it trained. Overlap is computed here; the model never infers it.
  const groupsByName = new Map(allExercises.map((e) => [e.name, e.muscle_groups]));
  const recencySessions = recent_sessions.map((s) => ({
    date: s.date,
    muscle_groups: [...new Set(s.sets.flatMap((set) => groupsByName.get(set.exercise_name) ?? []))],
  }));

  return {
    ...base,
    pr_bests: prBests,
    next_targets: nextPrTargets(prBests, allExercises),
    exercises: allExercises,
    recent_sessions,
    muscle_recency: muscleGroupRecency(recencySessions, now),
    equipment: activeProfile ? { name: activeProfile.name, items: activeProfile.items } : null,
    program_days,
    card_suggestion,
  };
}
