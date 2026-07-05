import { describe, expect, it } from "vitest";
import { daysSinceLastWorkout, isDetraining, nextPrTargets, remainingToday } from "@/lib/facts";
import type { Exercise, PlannedExercise, PrBest } from "@/types/db";

/**
 * GUIDE TESTS for the owner-written facts layer (ADR-0004).
 * These are the executable spec — red until you implement src/lib/facts/index.ts.
 * Run: npm test
 */

// ---------- daysSinceLastWorkout ----------

describe("daysSinceLastWorkout", () => {
  const today = new Date("2026-07-05T09:30:00");

  it("returns null with no history (Flow 4 first-run)", () => {
    expect(daysSinceLastWorkout([], today)).toBeNull();
  });

  it("counts whole days from the most recent session", () => {
    const sessions = [{ date: "2026-07-02" }, { date: "2026-06-28" }];
    expect(daysSinceLastWorkout(sessions, today)).toBe(3);
  });

  it("same-day workout → 0", () => {
    expect(daysSinceLastWorkout([{ date: "2026-07-05" }], today)).toBe(0);
  });

  it("ignores time-of-day — a late-night session yesterday is 1 day ago", () => {
    const lateToday = new Date("2026-07-05T00:05:00");
    expect(daysSinceLastWorkout([{ date: "2026-07-04" }], lateToday)).toBe(1);
  });

  it("crosses month boundaries correctly (the LLM failure mode this layer exists for)", () => {
    expect(daysSinceLastWorkout([{ date: "2026-06-21" }], today)).toBe(14);
  });
});

// ---------- isDetraining ----------

describe("isDetraining (business rule 6: gap ≥ 14 days)", () => {
  it("13 days → false", () => expect(isDetraining(13)).toBe(false));
  it("14 days → true (boundary)", () => expect(isDetraining(14)).toBe(true));
  it("no history (null) → false — first-run is not detraining", () =>
    expect(isDetraining(null)).toBe(false));
});

// ---------- remainingToday ----------

const planned = (id: string, exercise_id: string, target_sets: number, sort_order: number): PlannedExercise => ({
  id,
  program_day_id: "day1",
  exercise_id,
  target_sets,
  target_reps: 12,
  target_weight: null,
  rest_seconds: 120,
  notes: null,
  sort_order,
});

describe("remainingToday (Flow 7: split AM/PM sessions)", () => {
  const plan = [planned("p1", "squat", 4, 1), planned("p2", "rdl", 4, 2), planned("p3", "lunge", 3, 3)];

  it("nothing logged → everything remaining, in plan order", () => {
    const r = remainingToday(plan, []);
    expect(r.map((x) => x.planned.exercise_id)).toEqual(["squat", "rdl", "lunge"]);
    expect(r[0].setsRemaining).toBe(4);
  });

  it("partially done mid-day: squats fully logged AM, RDL half done → squat gone, rdl partial", () => {
    const logged = [
      ...Array(4).fill({ exercise_id: "squat" }),
      ...Array(2).fill({ exercise_id: "rdl" }),
    ];
    const r = remainingToday(plan, logged);
    expect(r.map((x) => x.planned.exercise_id)).toEqual(["rdl", "lunge"]);
    expect(r[0].setsDone).toBe(2);
    expect(r[0].setsRemaining).toBe(2);
  });

  it("ad-hoc exercise not in the plan (Flow 9) does not affect remaining", () => {
    const logged = [{ exercise_id: "pushup" }, { exercise_id: "pushup" }];
    expect(remainingToday(plan, logged)).toHaveLength(3);
  });

  it("everything logged → empty", () => {
    const logged = [
      ...Array(4).fill({ exercise_id: "squat" }),
      ...Array(4).fill({ exercise_id: "rdl" }),
      ...Array(3).fill({ exercise_id: "lunge" }),
    ];
    expect(remainingToday(plan, logged)).toEqual([]);
  });
});

// ---------- nextPrTargets ----------

const ex = (id: string, is_bodyweight: boolean, unit: Exercise["unit"] = "reps"): Exercise => ({
  id,
  name: id,
  aliases: [],
  is_bodyweight,
  unit,
  created_at: "2026-07-05",
});

const best = (exercise_id: string, best_reps: number, best_weight: number | null, is_bodyweight: boolean): PrBest => ({
  exercise_id,
  exercise_name: exercise_id,
  is_bodyweight,
  unit: "reps",
  best_reps,
  best_weight,
  achieved_on: "2026-07-01",
});

describe("nextPrTargets (Flow 8: +1–2 reps OR +2.5–5 lbs — minimum increments)", () => {
  it("weighted lift → same reps, +2.5 lbs (RDL 12 @ 32.5 → 12 @ 35)", () => {
    const [t] = nextPrTargets([best("rdl", 12, 32.5, false)], [ex("rdl", false)]);
    expect(t).toMatchObject({ target_reps: 12, target_weight: 35, rule_applied: "add_weight" });
  });

  it("bodyweight movement → +1 rep (pull-up 8 → 9, weight unchanged)", () => {
    const [t] = nextPrTargets([best("pullup", 8, null, true)], [ex("pullup", true)]);
    expect(t).toMatchObject({ target_reps: 9, target_weight: null, rule_applied: "add_reps" });
  });

  it("bodyweight WITH added load still progresses reps (tricep dip 12 @ BW+10 → 13 @ +10)", () => {
    const [t] = nextPrTargets([best("dip", 12, 10, true)], [ex("dip", true)]);
    expect(t).toMatchObject({ target_reps: 13, target_weight: 10, rule_applied: "add_reps" });
  });

  it("duration exercise (plank, unit=seconds) → +1 via add_reps rule", () => {
    const bests = [{ ...best("plank", 60, null, true), unit: "seconds" as const }];
    const [t] = nextPrTargets(bests, [ex("plank", true, "seconds")]);
    expect(t).toMatchObject({ target_reps: 61, rule_applied: "add_reps" });
  });
});
