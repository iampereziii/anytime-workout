import { describe, expect, it } from "vitest";
import {
  daysSinceLastWorkout,
  detectNewPrs,
  isDetraining,
  lastWorkoutRecency,
  muscleGroupRecency,
  nextPrTargets,
  SLEEP_AMBIGUITY_MAX_HOURS,
  sleepStateAmbiguous,
} from "@/lib/facts";
import type { Exercise, PrBest } from "@/types/db";

/**
 * GUIDE TESTS for the deterministic facts layer (ADR-0004, amended by ADR-0007).
 * The model now originates the workout; progression targets stay deterministic here.
 * Recovery is model judgment (ADR-0008) — no gate function lives here anymore, and
 * ADR-0009 retired `remainingToday` with the rest of the remaining-count layer (the
 * recommendation is a static suggestion), so its cases are gone from this file too.
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

// ---------- the retired remaining layer (ADR-0009) ----------

describe("remainingToday (retired — ADR-0009: the recommendation is a static suggestion)", () => {
  it("no longer exists in the facts layer — logging never derives against the card", async () => {
    const facts = await import("@/lib/facts");
    expect("remainingToday" in facts).toBe(false);
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

// Recovery gate retired 2026-07-13 (ADR-0008): `recoveryRecommended` deleted — recovery
// is now the model's judgment over the muscle-recency facts, so there is no deterministic
// gate function left to test. See prompts.test.ts (no gate lines) + recommendation.test.ts
// (no short-circuit; the model may still originate is_recovery on its own).

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

// ---------- lastWorkoutRecency + sleepStateAmbiguous (workout-timing-sleep-state brief) ----------

describe("lastWorkoutRecency (hour-granular recency — computed, never by the model)", () => {
  const TZ = "Asia/Manila"; // UTC+8, no DST — the app's confirmed home zone

  it("no sessions → null (first run)", () => {
    expect(lastWorkoutRecency([], new Date("2026-07-11T21:40:00+08:00"), TZ)).toBeNull();
  });

  it("sessions without timestamps → null (rows predating logged_at capture)", () => {
    const sessions = [{ date: "2026-07-10", last_logged_at: null }];
    expect(lastWorkoutRecency(sessions, new Date("2026-07-11T21:40:00+08:00"), TZ)).toBeNull();
  });

  it("same-day gap: morning workout, evening question → hours, not '0 days' (AC #1)", () => {
    const sessions = [{ date: "2026-07-11", last_logged_at: "2026-07-11T06:12:00+08:00" }];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T21:40:00+08:00"), TZ);
    expect(rec).toMatchObject({ hours_since: 15, live_logged: true, session_date: "2026-07-11" });
  });

  it("midnight-crossing short gap: 11:40 PM workout, 7 AM question → ~7h, live (AC #2 shape)", () => {
    const sessions = [{ date: "2026-07-10", last_logged_at: "2026-07-10T23:40:00+08:00" }];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T07:00:00+08:00"), TZ);
    expect(rec).toMatchObject({ hours_since: 7, live_logged: true });
  });

  it("backdated entry → live_logged false: logged_at is ENTRY time, no hour claim (AC #4 / Risk #1)", () => {
    // Yesterday's workout entered this morning: session date 07-10, entry instant 07-11.
    const sessions = [{ date: "2026-07-10", last_logged_at: "2026-07-11T09:00:00+08:00" }];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T10:00:00+08:00"), TZ);
    expect(rec).toMatchObject({ live_logged: false });
  });

  it("live-log guard uses the APP timezone, not the raw instant's date part (tz brief invariant)", () => {
    // 22:12Z on 07-10 IS 06:12 on 07-11 in Manila — a live morning log, not backdated.
    const sessions = [{ date: "2026-07-11", last_logged_at: "2026-07-10T22:12:00Z" }];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T10:00:00+08:00"), TZ);
    expect(rec).toMatchObject({ live_logged: true, hours_since: 3 });
  });

  it("picks the newest instant across sessions (unsorted, mixed offsets)", () => {
    const sessions = [
      { date: "2026-07-09", last_logged_at: "2026-07-09T18:00:00+08:00" },
      { date: "2026-07-11", last_logged_at: "2026-07-10T22:12:00Z" }, // = 07-11 06:12 Manila
      { date: "2026-07-10", last_logged_at: null },
    ];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T12:12:00+08:00"), TZ);
    expect(rec).toMatchObject({ session_date: "2026-07-11", hours_since: 6 });
  });

  it("future logged_at (clock skew / data drift) clamps to 0, never negative", () => {
    const sessions = [{ date: "2026-07-11", last_logged_at: "2026-07-11T12:00:00+08:00" }];
    const rec = lastWorkoutRecency(sessions, new Date("2026-07-11T11:00:00+08:00"), TZ);
    expect(rec?.hours_since).toBe(0);
  });
});

describe("sleepStateAmbiguous (the deterministic gate on the ONE sleep question)", () => {
  const TZ = "Asia/Manila";
  const at = (iso: string) => new Date(iso);
  const rec = (date: string, loggedAt: string, now: string) =>
    lastWorkoutRecency([{ date, last_logged_at: loggedAt }], at(now), TZ);

  it("threshold constant is 16h (brief Risk #2 — tunable in one line, pinned here)", () => {
    expect(SLEEP_AMBIGUITY_MAX_HOURS).toBe(16);
  });

  it("day rolled AND gap < 16h → ambiguous (the never-assume case)", () => {
    const now = "2026-07-11T07:00:00+08:00";
    const r = rec("2026-07-10", "2026-07-10T23:40:00+08:00", now);
    expect(sleepStateAmbiguous(r, at(now), TZ)).toBe(true);
  });

  it("same-day gap never fires — no day roll, no sleep assumption to get wrong", () => {
    const now = "2026-07-11T21:40:00+08:00"; // 15h later, same Manila day
    const r = rec("2026-07-11", "2026-07-11T06:12:00+08:00", now);
    expect(sleepStateAmbiguous(r, at(now), TZ)).toBe(false);
  });

  it("day rolled but gap >= 16h → not ambiguous (a waking block that long contains sleep)", () => {
    const now = "2026-07-11T01:00:00+08:00"; // 19h after a 6 AM session
    const r = rec("2026-07-10", "2026-07-10T06:00:00+08:00", now);
    expect(sleepStateAmbiguous(r, at(now), TZ)).toBe(false);
  });

  it("exactly 16h → not ambiguous (boundary is exclusive)", () => {
    const now = "2026-07-11T15:40:00+08:00";
    const r = rec("2026-07-10", "2026-07-10T23:40:00+08:00", now);
    expect(r?.hours_since).toBe(16);
    expect(sleepStateAmbiguous(r, at(now), TZ)).toBe(false);
  });

  it("backdated session never fires — its instant is entry time (Risk #1)", () => {
    const now = "2026-07-11T10:00:00+08:00";
    const r = rec("2026-07-10", "2026-07-11T09:00:00+08:00", now); // live_logged false
    expect(sleepStateAmbiguous(r, at(now), TZ)).toBe(false);
  });

  it("no recency (null) → false", () => {
    expect(sleepStateAmbiguous(null, at("2026-07-11T10:00:00+08:00"), TZ)).toBe(false);
  });
});
