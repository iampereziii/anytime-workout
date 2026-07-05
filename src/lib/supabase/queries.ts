import "server-only";
import { supabaseServer } from "./server";
import { dayNumberFor, toIsoDate } from "@/lib/dates";
import {
  daysSinceLastWorkout,
  isDetraining,
  muscleGroupRecency,
  nextPrTargets,
  remainingToday,
  type MuscleGroupRecency,
  type RemainingExercise,
} from "@/lib/facts";
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

export async function getTodayContext(now = new Date()): Promise<TodayContext> {
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
  const days_since = daysSinceLastWorkout(last_workout_date ? [{ date: last_workout_date }] : [], now);

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
}

export async function getChatContext(now = new Date()): Promise<ChatContext> {
  const sb = supabaseServer();
  const base = await getTodayContext(now);

  const [
    { data: bests, error: bestsErr },
    { data: exercises, error: exErr },
    { data: sessions, error: sessErr },
    { data: activeProfile, error: equipErr },
  ] = await Promise.all([
    sb.from("pr_bests").select("*"),
    sb.from("exercises").select("*"),
    sb
      .from("workout_sessions")
      .select("id, date, part, logged_sets(reps, weight, exercise:exercises(name, unit, is_bodyweight))")
      .order("date", { ascending: false })
      .limit(10),
    sb.from("equipment_profiles").select("name, items").eq("is_active", true).maybeSingle(),
  ]);
  throwIf(bestsErr);
  throwIf(exErr);
  throwIf(sessErr);
  throwIf(equipErr);

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
  };
}
