import { describe, expect, it } from "vitest";
import { recommendationSystemPrompt } from "@/lib/openai/prompts";
import { todayRecommendationSchema } from "@/lib/openai/schemas";

/**
 * AI-generated Today recommendation (ADR-0007). Covers the two pure pieces the
 * route composes:
 *  - the composer system prompt (originate the workout; recovery gate; catalog),
 *  - the schema (free-form focus + catalog-constrained lifts, or a recovery day).
 * The recommendation is pinned per calendar day by the route (finding 4).
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

  it("carries the deterministic recovery gate as a HARD rule", () => {
    const p = recommendationSystemPrompt(facts, exercises);
    expect(p).toContain("RECOVERY GATE (HARD)");
    expect(p).toContain("RECOVERY REQUIRED");
    expect(p).toContain("is_recovery = true");
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
