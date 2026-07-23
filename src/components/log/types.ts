import type { Exercise } from "@/types/db";

/** One confirmed-but-unsaved exercise block on the log page's pending list. */
export interface PendingEntry {
  key: string;
  exercise: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">;
  /** Per-set values in the exercise's unit — length = number of sets. */
  reps: number[];
  /** Per-set loads, positionally paired with `reps` — length = number of sets.
   *  ADDED lbs for bodyweight movements; absolute lbs otherwise; null = no load.
   *  Uniform entries repeat one value; only free-text parse produces varied
   *  loads (pyramid sets — ADR-0011, free-text door only in v1). */
  weight: (number | null)[];
}
