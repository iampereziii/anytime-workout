/**
 * Recommendation modes (feature brief: Adaptive Workout Planning).
 *
 * The mode is the owner's dial on HOW FAR a recommendation may leave the planned
 * program — a persistent context signal, not a program edit, so it stays inside
 * the ADR-0005 boundary (adaptation lives at the recommendation layer; the
 * program_days rows never change). Both the Today-card composer and chat read
 * the active mode and apply the matching coaching policy.
 *
 * PURE module (no server-only imports): shared by the prompts (server), the API
 * routes (server), the validators, AND the client mode picker.
 *
 *  - follow → Follow Program: use the planned workout whenever recovery allows.
 *  - adapt  → Adapt Program: reorder the program's own focuses to match recovery.
 *  - coach  → Coach Mode: ignore program order; recommend the highest-value workout.
 */

export const RECOMMENDATION_MODES = ["follow", "adapt", "coach"] as const;

export type RecommendationMode = (typeof RECOMMENDATION_MODES)[number];

/** De-facto behavior before modes existed: adapt the program to recovery, but keep
 *  the recommendation within the program's own focuses (the card's Risk #1 contract). */
export const DEFAULT_RECOMMENDATION_MODE: RecommendationMode = "adapt";

/** Short human labels for the picker — order matches least → most divergence. */
export const RECOMMENDATION_MODE_LABELS: Record<RecommendationMode, string> = {
  follow: "Follow Program",
  adapt: "Adapt Program",
  coach: "Coach Mode",
};

/** Narrow unknown DB/text to a valid mode; anything unexpected falls back to the default. */
export function asRecommendationMode(value: unknown): RecommendationMode {
  return RECOMMENDATION_MODES.includes(value as RecommendationMode)
    ? (value as RecommendationMode)
    : DEFAULT_RECOMMENDATION_MODE;
}
