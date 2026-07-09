import { describe, expect, it } from "vitest";
import {
  daysSinceLastWorkout,
  detectNewPrs,
  isDetraining,
  muscleGroupRecency,
  nextPrTargets,
  recoveryRecommended,
  remainingToday,
  type MuscleGroupRecency,
} from "@/lib/facts";
import type { Exercise, PrBest } from "@/types/db";

/**
 * GUIDE TESTS for the deterministic facts layer (ADR-0004, amended by ADR-0007).
 * The model now originates the workout; progression targets and the recovery gate
 * stay deterministic here. Run: npm test
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

// ---------- remainingToday (Flow 7 — vs the day's recommendation, ADR-0007) ----------

describe("remainingToday (recommended sets − logged sets; split AM/PM)", () => {
  const target = [
    { exercise_id: "squat", target_sets: 4 },
    { exercise_id: "rdl", target_sets: 4 },
    { exercise_id: "lunge", target_sets: 3 },
  ];

  it("nothing logged → everything remaining, in recommendation order", () => {
    const r = remainingToday(target, []);
    expect(r.map((x) => x.exercise_id)).toEqual(["squat", "rdl", "lunge"]);
    expect(r[0].setsRemaining).toBe(4);
  });

  it("partially done mid-day: squats fully logged AM, RDL half done → squat gone, rdl partial", () => {
    const logged = [...Array(4).fill({ exercise_id: "squat" }), ...Array(2).fill({ exercise_id: "rdl" })];
    const r = remainingToday(target, logged);
    expect(r.map((x) => x.exercise_id)).toEqual(["rdl", "lunge"]);
    expect(r[0].setsDone).toBe(2);
    expect(r[0].setsRemaining).toBe(2);
  });

  it("ad-hoc exercise not in the recommendation (Flow 9) does not affect remaining", () => {
    const logged = [{ exercise_id: "pushup" }, { exercise_id: "pushup" }];
    expect(remainingToday(target, logged)).toHaveLength(3);
  });

  it("everything logged → empty", () => {
    const logged = [
      ...Array(4).fill({ exercise_id: "squat" }),
      ...Array(4).fill({ exercise_id: "rdl" }),
      ...Array(3).fill({ exercise_id: "lunge" }),
    ];
    expect(remainingToday(target, logged)).toEqual([]);
  });

  it("an empty recommendation (recovery day) → nothing remaining", () => {
    expect(remainingToday([], [{ exercise_id: "squat" }])).toEqual([]);
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

// ---------- recoveryRecommended (re-homed 2026-07-07 guardrail, ADR-0007 finding 2) ----------

describe("recoveryRecommended (hard gate — forces recovery only at full-body exhaustion)", () => {
  const PARENTS = ["chest", "back", "shoulders", "biceps", "triceps", "core", "quads", "hamstrings", "glutes", "calves"];
  const rec = (entries: [string, number][]): MuscleGroupRecency[] =>
    entries.map(([muscle_group, days_since]) => ({ muscle_group, days_since, last_trained_on: "2026-07-06" }));

  it("first run (no recency) → not forced", () => {
    expect(recoveryRecommended([])).toEqual({ recommended: false, reason: null });
  });

  it("forces recovery when EVERY parent group was trained <=1 day ago", () => {
    const r = recoveryRecommended(rec(PARENTS.map((g) => [g, g === "chest" ? 0 : 1])));
    expect(r.recommended).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it("does NOT force recovery when a parent group is recovered (2+ days) — that group is trainable", () => {
    const r = recoveryRecommended(rec(PARENTS.map((g) => [g, g === "quads" ? 3 : 1])));
    expect(r.recommended).toBe(false);
  });

  it("does NOT force recovery when a parent group is cold (never trained in window) — it's fresh", () => {
    // Omit calves entirely: 9 parents trained yesterday, calves cold → train calves-ish.
    const r = recoveryRecommended(rec(PARENTS.filter((g) => g !== "calves").map((g) => [g, 1])));
    expect(r.recommended).toBe(false);
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
  default_rest_seconds: null,
  default_cue: null,
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

// ---------- detectNewPrs (unchanged; smoke) ----------

describe("detectNewPrs", () => {
  it("no prior best → no celebration (first log is a baseline, not a record)", () => {
    expect(detectNewPrs([], [{ exercise_id: "squat", reps: 10, weight: 20 }], [ex("squat", false)])).toEqual([]);
  });

  it("beats the weighted best on load → one PR", () => {
    const prs = detectNewPrs(
      [best("squat", 10, 20, false)],
      [{ exercise_id: "squat", reps: 10, weight: 22.5 }],
      [ex("squat", false)],
    );
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({ rule_applied: "weight", weight: 22.5 });
  });
});
