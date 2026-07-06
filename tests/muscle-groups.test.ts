import { describe, expect, it } from "vitest";
import {
  MUSCLE_GROUP_VOCABULARY,
  PARENT_GROUPS,
  PARENT_OF,
  SUBGROUPS,
  isValidMuscleGroup,
  parentOf,
  withParents,
} from "@/lib/muscle-groups";

/**
 * The fixed two-level muscle-group vocabulary (recency-first brief, Risk #3):
 * every sub-group rolls up to exactly one of the 10 parents; roll-up is what
 * makes recency read at both levels (AC #2).
 */

describe("vocabulary integrity", () => {
  it("has exactly the 10 parent groups from migration 0002", () => {
    expect([...PARENT_GROUPS].sort()).toEqual(
      ["back", "biceps", "calves", "chest", "core", "glutes", "hamstrings", "quads", "shoulders", "triceps"].sort(),
    );
  });

  it("every sub-group maps to exactly one parent, and that parent is a real parent", () => {
    for (const [sub, parent] of Object.entries(PARENT_OF)) {
      expect(PARENT_GROUPS).toContain(parent);
      expect(SUBGROUPS[parent]).toContain(sub);
    }
  });

  it("the vocabulary is parents + all sub-groups, with no duplicates", () => {
    const expected = [...PARENT_GROUPS, ...PARENT_GROUPS.flatMap((p) => SUBGROUPS[p])];
    expect(MUSCLE_GROUP_VOCABULARY).toEqual(expected);
    expect(new Set(MUSCLE_GROUP_VOCABULARY).size).toBe(MUSCLE_GROUP_VOCABULARY.length);
  });

  it("recognizes the Diamond Push-up tag set (parent + sub mix)", () => {
    for (const g of ["triceps", "chest_mid", "shoulders_front"]) expect(isValidMuscleGroup(g)).toBe(true);
    expect(isValidMuscleGroup("rear-delts")).toBe(false);
  });
});

describe("parentOf", () => {
  it("maps a parent to itself", () => {
    expect(parentOf("chest")).toBe("chest");
  });

  it("maps a sub-group to its parent", () => {
    expect(parentOf("chest_upper")).toBe("chest");
    expect(parentOf("shoulders_front")).toBe("shoulders");
  });

  it("returns null for an unknown tag (defensive — never throws)", () => {
    expect(parentOf("noodles")).toBeNull();
  });
});

describe("withParents (roll-up)", () => {
  it("adds the parent for each sub-group, keeping the sub-group", () => {
    expect(withParents(["chest_upper"]).sort()).toEqual(["chest", "chest_upper"]);
  });

  it("passes parents through unchanged", () => {
    expect(withParents(["chest", "triceps"]).sort()).toEqual(["chest", "triceps"]);
  });

  it("de-duplicates when a sub-group and its parent are both tagged", () => {
    expect(withParents(["chest", "chest_mid"]).sort()).toEqual(["chest", "chest_mid"]);
  });

  it("keeps unknown tags verbatim without rolling them up", () => {
    expect(withParents(["noodles"])).toEqual(["noodles"]);
  });

  it("handles the empty set", () => {
    expect(withParents([])).toEqual([]);
  });
});
