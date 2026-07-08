// Shared DB row types — keep in sync with supabase/migrations.
// PRs and chat messages are deliberately NOT modeled (derived view / ephemeral — see project spec).

export type ExerciseUnit = "reps" | "seconds" | "minutes";

export interface Exercise {
  id: string;
  name: string;
  aliases: string[];
  is_bodyweight: boolean;
  unit: ExerciseUnit;
  /** Muscle groups worked (primary + secondary); empty = cardio/none. Feeds per-group recency. */
  muscle_groups: string[];
  created_at: string;
}

export interface Program {
  id: string;
  name: string;
  is_active: boolean;
}

export interface ProgramDay {
  id: string;
  program_id: string;
  day_number: number; // 1–7
  label: string;
  notes: string | null; // recovery/conditioning days have notes, no planned lifts
}

export interface PlannedExercise {
  id: string;
  program_day_id: string;
  exercise_id: string;
  target_sets: number;
  /** Value in the exercise's unit. NULL = AMRAP ("max reps"). */
  target_reps: number | null;
  /** For bodyweight exercises this is ADDED load in lbs (NULL/0 = pure BW). */
  target_weight: number | null;
  rest_seconds: number | null;
  notes: string | null; // tempo cues: "slow negatives + 10-sec hold"
  sort_order: number;
}

export type SessionPart = "am" | "pm" | null;

export interface WorkoutSession {
  id: string;
  date: string; // ISO date (yyyy-mm-dd)
  part: SessionPart; // split sessions (Flow 7)
  notes: string | null;
  created_at: string;
}

export interface LoggedSet {
  id: string;
  session_id: string;
  exercise_id: string;
  set_number: number;
  /** Value in the exercise's unit (reps, seconds, or minutes). */
  reps: number;
  /** For bodyweight exercises this is ADDED load in lbs. */
  weight: number | null;
  logged_at: string;
}

export interface EquipmentProfile {
  id: string;
  name: string;
  items: string[];
  is_active: boolean;
}

/** Singleton settings row (id = 1). recommendation_mode is one of the values in
 *  src/lib/recommendation-mode.ts — see migration 0005. */
export interface AppSettings {
  id: number;
  recommendation_mode: string;
  updated_at: string;
}

/** Row shape of the pr_bests view (derived — never a table). */
export interface PrBest {
  exercise_id: string;
  exercise_name: string;
  is_bodyweight: boolean;
  unit: ExerciseUnit;
  best_reps: number;
  best_weight: number | null;
  achieved_on: string;
}
