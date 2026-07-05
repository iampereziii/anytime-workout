import { z } from "zod";

/**
 * Structured Outputs schemas (challenge #7).
 * The parse call must return schema-guaranteed JSON — never free-form text
 * that gets re-parsed by hand.
 */

/** One parsed exercise entry from a free-text log ("did 3x12 elevated, 3x10 dips"). */
export const ParsedExerciseSchema = z.object({
  /** The name as the user typed it — resolution to a canonical ID happens
   *  via the SAME trigram + interactive confirm flow as the combobox
   *  (business rule 2 — one dedup brain, two doors). Never auto-merged. */
  raw_name: z.string(),
  sets: z.number().int().positive(),
  /** Reps per set. Single value when uniform; per-set array when the user gave "12/12/11/10". */
  reps: z.union([z.number().int().positive(), z.array(z.number().int().positive())]),
  /** ADDED lbs for bodyweight movements; absolute lbs otherwise. Null = bodyweight/unknown. */
  weight_lbs: z.number().nullable(),
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
 * Today-card recommendation (feature brief: ai-today-recommendation).
 * The model PICKS a focus among the program's own day labels (Risk #1) and
 * composes a one-line headline + one-line reason — it never derives numbers
 * (ADR-0004). suggested_focus is a schema-constrained enum built from the live
 * program day labels, so the value always maps back to a real program day for
 * the "Suggested lifts" pill lookup. Built per-request because the allowed
 * labels come from the DB.
 */
export function todayRecommendationSchema(focuses: readonly [string, ...string[]]) {
  return z.object({
    /** One of the program's day labels (push/pull/legs/rest…). */
    suggested_focus: z.enum(focuses),
    /** One line, card headline — e.g. "Suggested: Pull". */
    headline: z.string(),
    /** One line citing the computed reason — e.g. "you hit push yesterday; back/biceps are 4 days cold". */
    reason: z.string(),
  });
}

export interface TodayRecommendation {
  suggested_focus: string;
  headline: string;
  reason: string;
}
