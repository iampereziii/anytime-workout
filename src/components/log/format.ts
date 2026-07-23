import type { Exercise } from "@/types/db";

/**
 * Pure display + normalization helpers for the log flow's per-set weights
 * (pyramid brief / ADR-0011). Pending entries carry a per-set weight array;
 * these render one summary string — collapsed to the pre-pyramid format when
 * the load is uniform (the dominant case, byte-for-byte unchanged), per-set
 * pairs ("12 @ 25 / 10 @ 30 / 8 @ 35 lbs") when it varies.
 */

export const unitLabel = { reps: "reps", seconds: "sec", minutes: "min" } as const;

/** Compact per-value suffix for the varied-weight pair format ("60s @ 25"). */
const pairSuffix = { reps: "", seconds: "s", minutes: "min" } as const;

/**
 * Normalize a parsed weight (single | per-set array | null) to a per-set array
 * of length `sets`. A short array pads with its last value; a long one trims —
 * the confirm flow shows the result, so a misaligned parse is visible pre-save.
 */
export function toPerSetWeights(weight: number | number[] | null, sets: number): (number | null)[] {
  if (Array.isArray(weight)) {
    return Array.from({ length: sets }, (_, i) => weight[i] ?? weight[weight.length - 1] ?? null);
  }
  return Array.from({ length: sets }, () => weight);
}

/** True when every set carries the same load (all-null counts as uniform). */
export function isUniformWeight(weights: (number | null)[]): boolean {
  return weights.every((w) => w === weights[0]);
}

/**
 * Pending-list summary: "3 × 12/10/8 reps @ 25 lbs" when the load is uniform
 * (identical to the pre-pyramid string), "12 @ 25 / 10 @ 30 / 8 @ 35 lbs"
 * (" lbs added" for bodyweight) when it varies per set.
 */
export function formatEntrySummary(
  reps: number[],
  weights: (number | null)[],
  unit: Exercise["unit"],
  isBodyweight: boolean,
): string {
  if (isUniformWeight(weights)) {
    const w = weights[0] ?? null;
    const load = w != null ? ` @ ${isBodyweight ? "BW +" : ""}${w} lbs` : "";
    return `${reps.length} × ${reps.join("/")} ${unitLabel[unit]}${load}`;
  }
  const suffix = pairSuffix[unit];
  const pairs = reps.map((r, i) => {
    const w = weights[i];
    return `${r}${suffix} @ ${w != null ? w : "BW"}`;
  });
  return `${pairs.join(" / ")} lbs${isBodyweight ? " added" : ""}`;
}

/**
 * Proposal-row summary (pre-resolution — no unit/bodyweight context yet):
 * "3 × 12/10/8 @ 25 lbs" uniform, "12 @ 25 / 10 @ 30 / 8 @ 35 lbs" varied.
 */
export function formatProposalSummary(reps: number[], weights: (number | null)[]): string {
  if (isUniformWeight(weights)) {
    const w = weights[0] ?? null;
    return `${reps.length} × ${reps.join("/")}${w != null ? ` @ ${w} lbs` : ""}`;
  }
  return `${reps.map((r, i) => `${r} @ ${weights[i] != null ? weights[i] : "BW"}`).join(" / ")} lbs`;
}
