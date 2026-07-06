import { describe, expect, it } from "vitest";
import {
  daysSinceLastWorkout,
  focusRecency,
  isDetraining,
  muscleGroupRecency,
  nextPrTargets,
  remainingToday,
} from "@/lib/facts";
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

// ---------- muscleGroupRecency (adaptive readjustment, Risk #1) ----------

describe("muscleGroupRecency", () => {
  const today = new Date("2026-07-06T09:30:00");

  it("returns [] with no sessions", () => {
    expect(muscleGroupRecency([], today)).toEqual([]);
  });

  it("computes days-since per group, soonest-trained first", () => {
    const result = muscleGroupRecency(
      [
        { date: "2026-07-04", muscle_groups: ["chest", "triceps"] },
        { date: "2026-07-01", muscle_groups: ["back", "biceps"] },
      ],
      today,
    );
    expect(result).toEqual([
      { muscle_group: "chest", days_since: 2, last_trained_on: "2026-07-04" },
      { muscle_group: "triceps", days_since: 2, last_trained_on: "2026-07-04" },
      { muscle_group: "back", days_since: 5, last_trained_on: "2026-07-01" },
      { muscle_group: "biceps", days_since: 5, last_trained_on: "2026-07-01" },
    ]);
  });

  it("keeps the most recent date when a group appears in several sessions", () => {
    const result = muscleGroupRecency(
      [
        { date: "2026-07-01", muscle_groups: ["chest"] },
        { date: "2026-07-05", muscle_groups: ["chest"] },
        { date: "2026-07-03", muscle_groups: ["chest"] },
      ],
      today,
    );
    expect(result).toEqual([{ muscle_group: "chest", days_since: 1, last_trained_on: "2026-07-05" }]);
  });

  it("reports 0 days for a group trained today", () => {
    const result = muscleGroupRecency([{ date: "2026-07-06", muscle_groups: ["quads"] }], today);
    expect(result[0]).toMatchObject({ muscle_group: "quads", days_since: 0 });
  });

  it("rolls a sub-group hit up to its parent — both levels reported (recency-first AC #2)", () => {
    const result = muscleGroupRecency([{ date: "2026-07-04", muscle_groups: ["chest_upper"] }], today);
    // chest_upper trains chest — freshness must read at both levels.
    expect(result).toEqual([
      { muscle_group: "chest", days_since: 2, last_trained_on: "2026-07-04" },
      { muscle_group: "chest_upper", days_since: 2, last_trained_on: "2026-07-04" },
    ]);
  });
});

// ---------- focusRecency (per-focus overlap facts, recency-first brief) ----------

describe("focusRecency", () => {
  const today = new Date("2026-07-07T09:30:00");
  // Push-dominant session yesterday (the incident): chest/triceps/shoulders at both levels.
  const recency = muscleGroupRecency(
    [
      { date: "2026-07-06", muscle_groups: ["chest_mid", "triceps", "shoulders_front"] },
      { date: "2026-07-01", muscle_groups: ["quads", "glutes"] },
    ],
    today,
  );

  it("computes per-focus groups (both levels) + freshest_overlap_days = min days-since", () => {
    const [upper, lower] = focusRecency(
      [
        { label: "Upper — Chest + Back", muscle_groups: ["chest_mid", "triceps", "back_lats"] },
        { label: "Lower Body", muscle_groups: ["quads", "glutes"] },
      ],
      recency,
    );

    // Upper overlaps yesterday's push (chest/triceps = 1d) but back is cold.
    expect(upper.freshest_overlap_days).toBe(1);
    expect(upper.groups).toContainEqual({ muscle_group: "chest", days_since: 1 });
    expect(upper.groups).toContainEqual({ muscle_group: "chest_mid", days_since: 1 });
    expect(upper.groups).toContainEqual({ muscle_group: "back_lats", days_since: null }); // cold

    // Lower's freshest muscle is 6 days old → the far staler (better) pick.
    expect(lower.freshest_overlap_days).toBe(6);
  });

  it("unions days that repeat a label into one focus row", () => {
    const result = focusRecency(
      [
        { label: "Full Body", muscle_groups: ["chest_mid"] },
        { label: "Full Body", muscle_groups: ["quads"] },
      ],
      recency,
    );
    expect(result).toHaveLength(1);
    expect(result[0].groups.map((g) => g.muscle_group)).toEqual(expect.arrayContaining(["chest", "chest_mid", "quads"]));
  });

  it("a day with an untagged exercise contributes nothing and does not crash", () => {
    const [focus] = focusRecency([{ label: "Chest", muscle_groups: ["chest_mid", ""] }], recency);
    // Empty-string tag rolls up to nothing; real tags still count.
    expect(focus.groups.some((g) => g.muscle_group === "chest_mid")).toBe(true);
    expect(focus.freshest_overlap_days).toBe(1);
  });

  it("an all-cardio focus (no groups) is fully cold, not an error", () => {
    const [focus] = focusRecency([{ label: "Conditioning", muscle_groups: [] }], recency);
    expect(focus.groups).toEqual([]);
    expect(focus.freshest_overlap_days).toBeNull();
  });

  it("a focus whose groups were never trained in the window is fully cold", () => {
    const [focus] = focusRecency([{ label: "Arms", muscle_groups: ["biceps"] }], recency);
    expect(focus.freshest_overlap_days).toBeNull();
    expect(focus.groups).toEqual([{ muscle_group: "biceps", days_since: null }]);
  });
});

// ---------- nextPrTargets ----------

const ex = (id: string, is_bodyweight: boolean, unit: Exercise["unit"] = "reps"): Exercise => ({
  id,
  name: id,
  aliases: [],
  is_bodyweight,
  unit,
  muscle_groups: [],
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
