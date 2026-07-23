import { z } from "zod";
import { MuscleGroupSchema } from "@/lib/validators";

/**
 * Structured Outputs schemas (challenge #7).
 * The parse call must return schema-guaranteed JSON — never free-form text
 * that gets re-parsed by hand.
 */

/**
 * Suggest-tags call (feature brief: ai-auto-tagging-new-exercises). GPT-5.4-mini
 * infers a new exercise's muscle groups from its NAME, constrained to the fixed
 * two-level vocabulary via the SAME `MuscleGroupSchema` enum the create route uses
 * — so a hallucinated group is impossible at the schema boundary. Empty is a valid
 * answer (cardio/mobility). The server re-validates before returning (AI proposes,
 * owner confirms — ADR-0004).
 */
export const SuggestedTagsSchema = z.object({
  muscle_groups: z.array(MuscleGroupSchema),
});

/** One parsed exercise entry from a free-text log ("did 3x12 elevated, 3x10 dips"). */
export const ParsedExerciseSchema = z.object({
  /** The name as the user typed it — resolution to a canonical ID happens
   *  via the SAME trigram + interactive confirm flow as the combobox
   *  (business rule 2 — one dedup brain, two doors). Never auto-merged. */
  raw_name: z.string(),
  sets: z.number().int().positive(),
  /** Reps per set. Single value when uniform; per-set array when the user gave "12/12/11/10". */
  reps: z.union([z.number().int().positive(), z.array(z.number().int().positive())]),
  /** ADDED lbs for bodyweight movements; absolute lbs otherwise. Null = bodyweight/unknown.
   *  Single value when one load covers every set; per-set array (positionally paired
   *  with reps) for pyramid-style entries — same union idiom as `reps` (ADR-0011). */
  weight_lbs: z.union([z.number(), z.array(z.number())]).nullable(),
});

export const ParsedLogSchema = z.object({
  /** Empty array + clarification_needed=true when sets/reps can't be extracted (business rule 5). */
  entries: z.array(ParsedExerciseSchema),
  clarification_needed: z.boolean(),
  clarification_question: z.string().nullable(),
});

export type ParsedLog = z.infer<typeof ParsedLogSchema>;

/** Recommendation table row (Flow 7: exercise / reps / sets / rest / weight + cues). */
export const RecommendationRowSchema = z.object({
  exercise: z.string(),
  sets: z.number().int().positive(),
  reps: z.string(), // "12" | "max" | "60 sec"
  rest: z.string(), // "2 min"
  weight: z.string(), // "32.5 lbs" | "BW" | "BW +10"
  cues: z.string().nullable(),
});

export const RecommendationSchema = z.object({
  answer: z.string(), // the composed coaching answer
  table: z.array(RecommendationRowSchema).nullable(),
});

export type Recommendation = z.infer<typeof RecommendationSchema>;

/**
 * Today recommendation (ADR-0007 — AI generates the daily recommendation).
 * The model now ORIGINATES the whole workout: it names the focus and composes the
 * lifts, sets, reps, and weight (the numbers ADR-0004 previously kept deterministic).
 * The two safety-critical signals it must NOT override — progression targets and
 * the recovery-readiness gate — are supplied to it as hard facts in the prompt.
 *
 * `exercise_name` is a schema-constrained enum built from the live `exercises`
 * catalog (confirmed design decision): the AI freely chooses which real movements
 * to program (and their sets/reps/weight), but cannot invent an exercise — so the
 * name always maps back to an id for the remaining-count and PR lookups, and stays
 * inside the equipment/muscle-tagging the app knows about. Built per-request
 * because the allowed names come from the DB.
 */
export function todayRecommendationSchema(exerciseNames: readonly [string, ...string[]]) {
  const lift = z.object({
    /** One of the app's real exercises (verbatim from the catalog). */
    exercise_name: z.enum(exerciseNames),
    target_sets: z.number().int().positive(),
    /** Value in the exercise's unit; null = AMRAP ("max"). */
    target_reps: z.number().int().positive().nullable(),
    /** ADDED lbs for bodyweight movements; absolute lbs otherwise; null = pure BW / n-a. */
    target_weight: z.number().nullable(),
    unit: z.enum(["reps", "seconds", "minutes"]),
    rest_seconds: z.number().int().positive().nullable(),
    /** Short tempo / form cue, or null. */
    cue: z.string().nullable(),
  });
  return z.object({
    /** Free-form focus label the model chooses — e.g. "Pull", "Lower Body", "Recovery". */
    focus: z.string(),
    /** One line, card headline — e.g. "Suggested: Pull". */
    headline: z.string(),
    /** One concise sentence citing the coaching reason, using only the supplied facts. */
    reason: z.string(),
    /** True → rest / active recovery day: `lifts` is null or empty. */
    is_recovery: z.boolean(),
    /** The composed workout, or null on a recovery day. */
    lifts: z.array(lift).nullable(),
  });
}

export interface TodayRecommendationLift {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: "reps" | "seconds" | "minutes";
  rest_seconds: number | null;
  cue: string | null;
}

export interface TodayRecommendation {
  focus: string;
  headline: string;
  reason: string;
  is_recovery: boolean;
  lifts: TodayRecommendationLift[] | null;
}
