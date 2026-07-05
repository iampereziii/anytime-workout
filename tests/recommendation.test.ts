import { describe, expect, it } from "vitest";
import { recommendationFingerprint } from "@/lib/facts";
import { recommendationSystemPrompt } from "@/lib/openai/prompts";
import { todayRecommendationSchema } from "@/lib/openai/schemas";

/**
 * Feature: AI-driven Today recommendation card.
 * Covers the three pure pieces the route composes:
 *  - the cache fingerprint (AC #4: reload without a new log/date = same key),
 *  - the composer system prompt (Risk #1 focus constraint + ADR-0005 guardrail),
 *  - the schema-constrained focus enum (numbers/choices never free-form).
 */

// ---------- recommendationFingerprint (cache invalidation, AC #4) ----------

describe("recommendationFingerprint", () => {
  it("is stable for the same date + latest session (reload = cache hit)", () => {
    expect(recommendationFingerprint("2026-07-06", "sess-1")).toBe(
      recommendationFingerprint("2026-07-06", "sess-1"),
    );
  });

  it("changes when a new session is logged (new latest id → regenerate)", () => {
    expect(recommendationFingerprint("2026-07-06", "sess-1")).not.toBe(
      recommendationFingerprint("2026-07-06", "sess-2"),
    );
  });

  it("changes when the date rolls over (midnight → regenerate)", () => {
    expect(recommendationFingerprint("2026-07-06", "sess-1")).not.toBe(
      recommendationFingerprint("2026-07-07", "sess-1"),
    );
  });

  it("encodes no-history distinctly (never collides with a real session id)", () => {
    expect(recommendationFingerprint("2026-07-06", null)).toBe("2026-07-06:none");
  });
});

// ---------- recommendationSystemPrompt (Risk #1 + ADR-0005) ----------

describe("recommendationSystemPrompt", () => {
  const facts = "=== FACTS ===\nDays since last workout: 1\n=== END FACTS ===";
  const focuses = ["Push", "Pull", "Legs", "Rest"];

  it("constrains suggested_focus to the program's own day labels (Risk #1)", () => {
    const p = recommendationSystemPrompt(facts, focuses, "Rest");
    expect(p).toContain("Push | Pull | Legs | Rest");
  });

  it("states today's calendar plan so the model knows the baseline", () => {
    expect(recommendationSystemPrompt(facts, focuses, "Rest")).toContain('calendar plan for today is: "Rest"');
  });

  it("handles a no-label (recovery) day", () => {
    expect(recommendationSystemPrompt(facts, focuses, null)).toContain("no lifting label");
  });

  it("carries the ADR-0005 guardrail: no computed reason → plan as written", () => {
    const p = recommendationSystemPrompt(facts, focuses, "Rest").toLowerCase();
    expect(p).toContain("baseline");
    expect(p).toContain("guardrail");
  });

  it("forbids recomputing the facts (ADR-0004)", () => {
    expect(recommendationSystemPrompt(facts, focuses, "Rest")).toContain("GROUND TRUTH");
  });

  it("embeds the facts block verbatim", () => {
    expect(recommendationSystemPrompt(facts, focuses, "Rest")).toContain(facts);
  });
});

// ---------- todayRecommendationSchema (schema-constrained focus) ----------

describe("todayRecommendationSchema", () => {
  const schema = todayRecommendationSchema(["Push", "Pull", "Legs", "Rest"]);

  it("accepts a focus within the allowed labels", () => {
    const parsed = schema.parse({ suggested_focus: "Pull", headline: "Suggested: Pull", reason: "push yesterday" });
    expect(parsed.suggested_focus).toBe("Pull");
  });

  it("rejects a focus outside the program's labels (can't invent a day)", () => {
    expect(() => schema.parse({ suggested_focus: "Cardio", headline: "x", reason: "y" })).toThrow();
  });
});
