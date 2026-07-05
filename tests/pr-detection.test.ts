import { describe, expect, it } from "vitest";
import { detectNewPrs } from "@/lib/facts";
import type { Exercise, PrBest } from "@/types/db";

/**
 * GUIDE TESTS for new-PR detection (feature brief: pr-celebration-on-new-best).
 * Business rule 3 semantics, mirroring the pr_bests view ordering:
 * weighted → weight first, reps tie-break; bodyweight → reps first, added-weight tie-break.
 */

const best = (exercise_id: string, is_bodyweight: boolean, best_reps: number, best_weight: number | null): PrBest => ({
  exercise_id,
  exercise_name: exercise_id,
  is_bodyweight,
  unit: "reps",
  best_reps,
  best_weight,
  achieved_on: "2026-06-29",
});

const ex = (id: string, is_bodyweight: boolean) => ({ id, is_bodyweight }) as Pick<Exercise, "id" | "is_bodyweight">;

const ROW = "row"; // weighted: Barbell Row, best 12 @ 32.5
const PUSHUP = "pushup"; // bodyweight: best 21 reps @ BW
const INCLINE = "incline"; // bodyweight variation, separate track

const bests = [best(ROW, false, 12, 32.5), best(PUSHUP, true, 21, null), best(INCLINE, true, 14, null)];
const exercises = [ex(ROW, false), ex(PUSHUP, true), ex(INCLINE, true)];

describe("detectNewPrs — weighted movements (weight first, reps tie-break)", () => {
  it("more weight is a PR even at fewer reps", () => {
    const prs = detectNewPrs(bests, [{ exercise_id: ROW, reps: 10, weight: 35 }], exercises);
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ exercise_id: ROW, reps: 10, weight: 35, rule_applied: "weight" });
    expect(prs[0].previous).toEqual({ reps: 12, weight: 32.5 });
  });

  it("equal weight + more reps is a PR (tie-break)", () => {
    const prs = detectNewPrs(bests, [{ exercise_id: ROW, reps: 13, weight: 32.5 }], exercises);
    expect(prs).toHaveLength(1);
  });

  it("equal weight + equal reps is NOT a PR", () => {
    expect(detectNewPrs(bests, [{ exercise_id: ROW, reps: 12, weight: 32.5 }], exercises)).toHaveLength(0);
  });

  it("less weight is NOT a PR regardless of reps", () => {
    expect(detectNewPrs(bests, [{ exercise_id: ROW, reps: 20, weight: 30 }], exercises)).toHaveLength(0);
  });
});

describe("detectNewPrs — bodyweight movements (reps first, added-weight tie-break)", () => {
  it("more reps is a PR", () => {
    const prs = detectNewPrs(bests, [{ exercise_id: PUSHUP, reps: 22, weight: null }], exercises);
    expect(prs).toHaveLength(1);
    expect(prs[0].rule_applied).toBe("reps");
  });

  it("equal reps + more added load is a PR (tie-break, BW+10 beats BW)", () => {
    const prs = detectNewPrs(bests, [{ exercise_id: PUSHUP, reps: 21, weight: 10 }], exercises);
    expect(prs).toHaveLength(1);
  });

  it("fewer reps is NOT a PR", () => {
    expect(detectNewPrs(bests, [{ exercise_id: PUSHUP, reps: 20, weight: null }], exercises)).toHaveLength(0);
  });
});

describe("detectNewPrs — per-variation and batch semantics", () => {
  it("per variation: an Incline Push-up PR never triggers against the Push-up best (rule 3)", () => {
    const prs = detectNewPrs(bests, [{ exercise_id: INCLINE, reps: 15, weight: null }], exercises);
    expect(prs).toHaveLength(1);
    expect(prs[0].exercise_id).toBe(INCLINE);
    // 15 reps would NOT beat Push-up's 21 — separate tracks is the point.
  });

  it("no prior best → no celebration (first log is a baseline, not a broken record)", () => {
    expect(detectNewPrs(bests, [{ exercise_id: "brand-new", reps: 100, weight: 100 }], exercises)).toHaveLength(0);
  });

  it("multiple beating sets in one save → ONE entry, the best of the batch", () => {
    const prs = detectNewPrs(
      bests,
      [
        { exercise_id: ROW, reps: 12, weight: 35 },
        { exercise_id: ROW, reps: 10, weight: 37.5 },
        { exercise_id: ROW, reps: 12, weight: 34 },
      ],
      exercises,
    );
    expect(prs).toHaveLength(1);
    expect(prs[0].weight).toBe(37.5);
  });

  it("mixed save: only the beating exercises celebrate", () => {
    const prs = detectNewPrs(
      bests,
      [
        { exercise_id: ROW, reps: 12, weight: 32.5 }, // ties — no
        { exercise_id: PUSHUP, reps: 23, weight: null }, // beats — yes
      ],
      exercises,
    );
    expect(prs.map((p) => p.exercise_id)).toEqual([PUSHUP]);
  });
});
