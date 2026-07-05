import { describe, expect, it } from "vitest";
import { normalizeExerciseName } from "@/lib/exercises/normalize";

/** Feature brief: exercise-name-normalization — rule confirmed 2026-07-05. */

describe("normalizeExerciseName", () => {
  it("splits camelCase", () => {
    expect(normalizeExerciseName("benchPress")).toBe("Bench Press");
  });

  it("splits PascalCase", () => {
    expect(normalizeExerciseName("BenchPress")).toBe("Bench Press");
  });

  it("collapses whitespace and title-cases", () => {
    expect(normalizeExerciseName("BENCH  press")).toBe("Bench Press");
    expect(normalizeExerciseName("  bench press  ")).toBe("Bench Press");
  });

  it("strips dangling hyphens (the live Diamond- Push-up case)", () => {
    expect(normalizeExerciseName("Diamond- Push-up")).toBe("Diamond Push-up");
    expect(normalizeExerciseName("diamond push-up")).toBe("Diamond Push-up");
  });

  it("hyphenated compounds follow seed style (Push-up, not Push-Up)", () => {
    expect(normalizeExerciseName("push-UP")).toBe("Push-up");
    expect(normalizeExerciseName("chin-up")).toBe("Chin-up");
  });

  it("known abbreviations uppercase regardless of input case", () => {
    expect(normalizeExerciseName("db shoulder press")).toBe("DB Shoulder Press");
    expect(normalizeExerciseName("rdl")).toBe("RDL");
    expect(normalizeExerciseName("ohp")).toBe("OHP");
  });

  it("user-typed short all-caps tokens are preserved", () => {
    expect(normalizeExerciseName("ATG split squat")).toBe("ATG Split Squat");
  });

  it("is idempotent — normalize(normalize(x)) === normalize(x)", () => {
    const inputs = ["benchPress", "Diamond- Push-up", "db shoulder press", "Walk / Mobility", "Push-up"];
    for (const x of inputs) {
      const once = normalizeExerciseName(x);
      expect(normalizeExerciseName(once)).toBe(once);
    }
  });

  it("leaves already-normalized seed names untouched", () => {
    for (const name of ["Barbell Row", "Incline Push-up", "DB Shoulder Press", "Hanging Leg Raise"]) {
      expect(normalizeExerciseName(name)).toBe(name);
    }
  });
});
