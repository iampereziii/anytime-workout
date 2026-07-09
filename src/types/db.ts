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
  /** One rest + cue per exercise, flattened from the retired program (migration 0006,
   *  ADR-0007). Composition hints for the recommendation composer; NULL = never planned. */
  default_rest_seconds: number | null;
  default_cue: string | null;
  created_at: string;
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
