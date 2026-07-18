import { describe, expect, it } from "vitest";
import { recommendationSystemPrompt } from "@/lib/openai/prompts";
import { todayRecommendationSchema, type TodayRecommendation } from "@/lib/openai/schemas";
import { toPayload } from "@/lib/recommendation/payload";

/**
 * AI-generated Today recommendation (ADR-0007, amended by ADR-0009 — the
 * recommendation is a static suggestion). Covers the pure pieces the routes build on:
 *  - the composer system prompt (originate the workout; catalog constraint),
 *  - the schema (free-form focus + catalog-constrained lifts, or a recovery day),
 *  - the client payload contract shared by GET /api/recommendation and POST /new.
 * The recommendation is pinned per calendar day, overwritten only by POST /new.
 */

// ---------- recommendationSystemPrompt (originate the workout; ADR-0007) ----------

describe("recommendationSystemPrompt", () => {
  const facts = "=== FACTS ===\nDays since last workout: 1\n=== END FACTS ===";
  const exercises = ["Squat", "Deadlift", "Pull-up"];

  it("instructs the model to originate the workout (focus + composed lifts)", () => {
    const p = recommendationSystemPrompt(facts, exercises).toLowerCase();
    expect(p).toContain("compose");
    expect(p).toContain("focus");
    expect(p).toContain("sets, reps, weight");
  });

  it("constrains exercise choice to the allowed catalog (can't invent a movement)", () => {
    expect(recommendationSystemPrompt(facts, exercises)).toContain("Squat | Deadlift | Pull-up");
  });

  it("carries NO deterministic recovery gate (ADR-0008 — recovery is model judgment)", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).not.toContain("RECOVERY GATE (HARD)");
    expect(p).not.toContain("RECOVERY REQUIRED");
  });

  it("treats the computed PR targets as the progression anchor", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).toContain("PROGRESSION");
    expect(p).toContain("Next PR target");
    expect(p).toContain("progression anchor");
  });

  it("keeps the graded recovery heuristic (0-1 avoid / 2 acceptable / 3-5 excellent / 6+ priority)", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).toContain("0-1 days since a muscle group was trained");
    expect(p).toContain("3-5 days");
    expect(p).toContain("6+ days");
  });

  it("forbids recomputing the facts (ADR-0004) and embeds the facts block verbatim", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).toContain("source of truth");
    expect(p).toContain(facts);
  });

  it("has no stored-program or recommendation-mode language (retired)", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).not.toContain("RECOMMENDATION MODE");
    expect(p).not.toContain("calendar plan");
  });
});

// ---------- todayRecommendationSchema (free-form focus + catalog-constrained lifts) ----------

describe("todayRecommendationSchema", () => {
  const schema = todayRecommendationSchema(["Squat", "Deadlift", "Pull-up"]);

  it("accepts a composed workout using catalog exercises", () => {
    const parsed = schema.parse({
      focus: "Lower Body",
      headline: "Suggested: Lower Body",
      reason: "Legs are 5 days recovered.",
      is_recovery: false,
      lifts: [
        { exercise_name: "Squat", target_sets: 4, target_reps: 8, target_weight: 20, unit: "reps", rest_seconds: 120, cue: null },
      ],
    });
    expect(parsed.lifts?.[0].exercise_name).toBe("Squat");
  });

  it("rejects a lift naming an exercise outside the catalog (can't invent a movement)", () => {
    expect(() =>
      schema.parse({
        focus: "Arms",
        headline: "x",
        reason: "y",
        is_recovery: false,
        lifts: [
          { exercise_name: "Barbell Curl", target_sets: 3, target_reps: 12, target_weight: 15, unit: "reps", rest_seconds: 90, cue: null },
        ],
      }),
    ).toThrow();
  });

  it("accepts a recovery day (lifts null)", () => {
    const parsed = schema.parse({
      focus: "Active Recovery",
      headline: "Recovery First",
      reason: "Everything was trained within the last day.",
      is_recovery: true,
      lifts: null,
    });
    expect(parsed.is_recovery).toBe(true);
    expect(parsed.lifts).toBeNull();
  });

  it("allows AMRAP (null reps) and pure bodyweight (null weight)", () => {
    const parsed = schema.parse({
      focus: "Pull",
      headline: "Suggested: Pull",
      reason: "Back is 4 days cold.",
      is_recovery: false,
      lifts: [
        { exercise_name: "Pull-up", target_sets: 3, target_reps: null, target_weight: null, unit: "reps", rest_seconds: 120, cue: "slow negatives" },
      ],
    });
    expect(parsed.lifts?.[0].target_reps).toBeNull();
    expect(parsed.lifts?.[0].target_weight).toBeNull();
  });
});

// ---------- toPayload (the API contract — static suggestion + done, ADR-0009) ----------

describe("toPayload (GET /api/recommendation and POST /new return this shape)", () => {
  const rec: TodayRecommendation = {
    focus: "Lower Body",
    headline: "Suggested: Lower Body",
    reason: "Legs are 5 days recovered.",
    is_recovery: false,
    lifts: [
      { exercise_name: "Squat", target_sets: 4, target_reps: 8, target_weight: 20, unit: "reps", rest_seconds: 120, cue: null },
    ],
  };

  it("carries the suggested targets verbatim from the pin", () => {
    const p = toPayload(rec);
    expect(p.focus).toBe("Lower Body");
    expect(p.lifts).toEqual([
      { exercise_name: "Squat", target_sets: 4, target_reps: 8, target_weight: 20, unit: "reps", rest_seconds: 120, cue: null },
    ]);
  });

  it("has NO progress fields — the card can't count down what it isn't sent", () => {
    const p = toPayload(rec);
    expect(p).not.toHaveProperty("remaining_count");
    expect(p.lifts?.[0]).not.toHaveProperty("sets_done");
    expect(p.lifts?.[0]).not.toHaveProperty("sets_remaining");
  });

  it("has NO per-day state — no done marker (ADR-0009 amendment)", () => {
    expect(toPayload(rec)).not.toHaveProperty("done");
  });

  it("is a pure projection of the pin — the same pin renders identically all day", () => {
    // The ADR-0009 finish line: logging a set changes history and PRs, never this.
    // The pin is the ONLY input, so there is nothing to drift.
    expect(toPayload(rec)).toEqual(toPayload(rec));
  });

  it("a recovery day carries null lifts", () => {
    const p = toPayload({ ...rec, is_recovery: true, lifts: null });
    expect(p.is_recovery).toBe(true);
    expect(p.lifts).toBeNull();
  });
});
