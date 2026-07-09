import { z } from "zod";
import { MUSCLE_GROUP_VOCABULARY } from "@/lib/muscle-groups";

/** Zod input schemas for every API route — parse at the boundary, trust nothing. */

export const ExerciseUnitSchema = z.enum(["reps", "seconds", "minutes"]);

/** A single muscle-group tag — constrained to the fixed two-level vocabulary
 *  (recency-first brief, Risk #3). The column is unconstrained text[], so THIS
 *  is the enforcement point: no free-text groups reach the DB. */
export const MuscleGroupSchema = z.enum(MUSCLE_GROUP_VOCABULARY as [string, ...string[]]);

export const ExerciseCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  aliases: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  is_bodyweight: z.boolean().default(false),
  unit: ExerciseUnitSchema.default("reps"),
  /** Two-level muscle-group tags so a new exercise is recency-visible at birth
   *  (recency-first brief). Empty is allowed (cardio/mobility). De-duplicated. */
  muscle_groups: z.array(MuscleGroupSchema).max(12).default([]),
});
export type ExerciseCreate = z.infer<typeof ExerciseCreateSchema>;

export const LoggedSetInputSchema = z.object({
  exercise_id: z.uuid(),
  /** 1..n within the session, per exercise. */
  set_number: z.number().int().positive(),
  /** Value in the exercise's unit (reps, seconds, or minutes). */
  reps: z.number().int().nonnegative().max(10_000),
  /** ADDED lbs for bodyweight movements; absolute lbs otherwise. */
  weight: z.number().nonnegative().max(10_000).nullable(),
});

export const LogRequestSchema = z.object({
  /** Local date the sets belong to — offline-queued writes keep their original day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected yyyy-mm-dd"),
  part: z.enum(["am", "pm"]).nullable().default(null),
  notes: z.string().max(500).nullable().default(null),
  sets: z.array(LoggedSetInputSchema).min(1).max(200),
});
export type LogRequest = z.infer<typeof LogRequestSchema>;

export const ChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Recent conversation turns — chat is ephemeral client-side (v1 spec decision). */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(12)
    .default([]),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ParseRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
});

/** POST /api/exercises/suggest-tags — infer muscle-group tags for a NEW exercise
 *  from its name (feature brief: ai-auto-tagging-new-exercises). Same name bounds
 *  as ExerciseCreateSchema so the suggestion runs on exactly what will be created. */
export const SuggestTagsRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** PUT /api/equipment-profiles — set the active profile by id (adaptive readjustment, Risk #4). */
export const SetActiveProfileSchema = z.object({
  id: z.uuid(),
});
