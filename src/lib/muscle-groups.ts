/**
 * The muscle-group vocabulary — single source of truth for tagging + recency
 * (feature brief: recency-first-today-recommendation, Risk #3).
 *
 * PURE (no server-only / no env / no clock) so it's shared by the Zod validator,
 * the facts engine, and the client create-exercise picker. The column itself is
 * an unconstrained text[]; THIS vocabulary + the Zod enum are the enforcement
 * point (no free-text groups — changing the vocabulary is a code change).
 *
 * Two levels:
 *  - 10 PARENT groups (the coarse signal migration 0002 shipped).
 *  - fixed SUB-groups, each rolling up to exactly one parent (the sharp signal).
 * A tag may be either a parent OR a sub-group (e.g. Diamond Push-up →
 * `triceps, chest_mid, shoulders_front` mixes both). Recency is computed at BOTH
 * levels so a coarse hit never goes blind: training a sub-group refreshes its
 * parent (see `withParents`), so freshness reads correctly whichever level a
 * given exercise was tagged at.
 */

/** The 10 parent muscle groups (migration 0002). Order = display order. */
export const PARENT_GROUPS = [
  "chest",
  "back",
  "shoulders",
  "biceps",
  "triceps",
  "core",
  "quads",
  "hamstrings",
  "glutes",
  "calves",
] as const;

export type ParentGroup = (typeof PARENT_GROUPS)[number];

/**
 * Parent → its sub-groups (display order). Parents with no meaningful
 * programming sub-division (quads, hamstrings) carry none and are tagged at the
 * parent level. Adding a sub-group here is the only way to extend the vocabulary.
 */
export const SUBGROUPS: Record<ParentGroup, readonly string[]> = {
  chest: ["chest_upper", "chest_mid", "chest_lower"],
  back: ["back_lats", "back_upper", "back_lower"],
  shoulders: ["shoulders_front", "shoulders_side", "shoulders_rear"],
  biceps: ["biceps_long", "biceps_short"],
  triceps: ["triceps_long", "triceps_lateral", "triceps_medial"],
  core: ["core_upper", "core_lower", "core_obliques"],
  quads: [],
  hamstrings: [],
  glutes: ["glutes_max", "glutes_med"],
  calves: ["calves_gastroc", "calves_soleus"],
};

/** Sub-group → parent, derived from SUBGROUPS. */
export const PARENT_OF: Readonly<Record<string, ParentGroup>> = Object.freeze(
  Object.fromEntries(
    PARENT_GROUPS.flatMap((parent) => SUBGROUPS[parent].map((sub) => [sub, parent] as const)),
  ),
);

/**
 * The full allowed vocabulary: every parent + every sub-group. This is the
 * enforcement list — the Zod enum for exercise creation is built from it.
 */
export const MUSCLE_GROUP_VOCABULARY: readonly string[] = [
  ...PARENT_GROUPS,
  ...PARENT_GROUPS.flatMap((p) => SUBGROUPS[p]),
];

const VOCAB_SET = new Set(MUSCLE_GROUP_VOCABULARY);

/** True when `group` is a valid tag (a parent or a sub-group). */
export function isValidMuscleGroup(group: string): boolean {
  return VOCAB_SET.has(group);
}

/**
 * The parent of a group: a parent maps to itself, a sub-group to its parent, an
 * unknown tag to null (defensive — unknown tags are dropped from roll-up, never
 * crash). Used to roll a sub-group hit up to its parent.
 */
export function parentOf(group: string): ParentGroup | null {
  if ((PARENT_GROUPS as readonly string[]).includes(group)) return group as ParentGroup;
  return PARENT_OF[group] ?? null;
}

/**
 * Expand a set of tags to include the rolled-up parents (the roll-up that makes
 * recency read at both levels — AC #2). `["chest_upper"]` → `["chest_upper",
 * "chest"]`; parents pass through; unknown tags are kept verbatim (they simply
 * won't match any focus, and never throw). De-duplicated, order-stable.
 */
export function withParents(groups: string[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    out.add(g);
    const p = parentOf(g);
    if (p) out.add(p);
  }
  return [...out];
}
