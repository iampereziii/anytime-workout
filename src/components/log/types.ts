import type { Exercise } from "@/types/db";

/** One confirmed-but-unsaved exercise block on the log page's pending list. */
export interface PendingEntry {
  key: string;
  exercise: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">;
  /** Per-set values in the exercise's unit — length = number of sets. */
  reps: number[];
  /** ADDED lbs for bodyweight movements; absolute lbs otherwise. */
  weight: number | null;
}
