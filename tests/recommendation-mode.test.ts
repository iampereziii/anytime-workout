import { describe, expect, it } from "vitest";
import {
  asRecommendationMode,
  DEFAULT_RECOMMENDATION_MODE,
  RECOMMENDATION_MODE_LABELS,
  RECOMMENDATION_MODES,
} from "@/lib/recommendation-mode";
import { modeDirective } from "@/lib/openai/prompts";
import { SetRecommendationModeSchema } from "@/lib/validators";

/**
 * Feature: Adaptive Workout Planning — Recommendation Modes.
 * Covers the pure pieces: the mode vocabulary, the text→mode narrowing (DB read
 * safety), the per-mode coaching directive, and the API input schema.
 */

describe("recommendation mode vocabulary", () => {
  it("exposes exactly follow | adapt | coach", () => {
    expect([...RECOMMENDATION_MODES]).toEqual(["follow", "adapt", "coach"]);
  });

  it("defaults to adapt (the pre-modes de-facto behavior)", () => {
    expect(DEFAULT_RECOMMENDATION_MODE).toBe("adapt");
  });

  it("has a human label for every mode", () => {
    for (const m of RECOMMENDATION_MODES) {
      expect(RECOMMENDATION_MODE_LABELS[m]).toBeTruthy();
    }
  });
});

describe("asRecommendationMode (safe narrowing of DB/text values)", () => {
  it("passes valid modes through unchanged", () => {
    expect(asRecommendationMode("follow")).toBe("follow");
    expect(asRecommendationMode("adapt")).toBe("adapt");
    expect(asRecommendationMode("coach")).toBe("coach");
  });

  it("falls back to the default for junk, null, or unknown values", () => {
    expect(asRecommendationMode("nonsense")).toBe(DEFAULT_RECOMMENDATION_MODE);
    expect(asRecommendationMode(null)).toBe(DEFAULT_RECOMMENDATION_MODE);
    expect(asRecommendationMode(undefined)).toBe(DEFAULT_RECOMMENDATION_MODE);
    expect(asRecommendationMode(42)).toBe(DEFAULT_RECOMMENDATION_MODE);
  });
});

describe("modeDirective (per-mode coaching policy)", () => {
  it("Follow keeps the calendar plan and forbids reordering for optimization", () => {
    const d = modeDirective("follow");
    expect(d).toContain("FOLLOW PROGRAM");
    expect(d).toContain("Do NOT reorder");
  });

  it("Adapt reorders the program's own focuses to match recovery", () => {
    const d = modeDirective("adapt");
    expect(d).toContain("ADAPT PROGRAM");
    expect(d).toContain("reorder");
  });

  it("Coach ignores program order entirely", () => {
    const d = modeDirective("coach");
    expect(d).toContain("COACH");
    expect(d).toContain("Ignore the program's day order entirely");
  });

  it("gives each mode a distinct directive", () => {
    const all = RECOMMENDATION_MODES.map(modeDirective);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("SetRecommendationModeSchema (API boundary)", () => {
  it("accepts a valid mode", () => {
    expect(SetRecommendationModeSchema.parse({ mode: "coach" }).mode).toBe("coach");
  });

  it("rejects an unknown mode", () => {
    expect(() => SetRecommendationModeSchema.parse({ mode: "beastmode" })).toThrow();
  });

  it("rejects a missing mode", () => {
    expect(() => SetRecommendationModeSchema.parse({})).toThrow();
  });
});
