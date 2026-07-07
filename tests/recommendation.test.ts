import { describe, expect, it } from "vitest";
import { recommendationFingerprint } from "@/lib/facts";
import { RECOMMENDATION_PROMPT_VERSION, recommendationSystemPrompt } from "@/lib/openai/prompts";
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
    expect(recommendationFingerprint("2026-07-06", null)).toBe(
      `2026-07-06:none:p${RECOMMENDATION_PROMPT_VERSION}`,
    );
  });

  it("carries the prompt version — a coaching-regime deploy is a cache miss, not a stale day", () => {
    expect(recommendationFingerprint("2026-07-06", "sess-1")).toContain(`:p${RECOMMENDATION_PROMPT_VERSION}`);
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

  it("keeps the program a baseline and diverges only for a computed coaching reason (ADR-0005)", () => {
    const p = recommendationSystemPrompt(facts, focuses, "Rest").toLowerCase();
    expect(p).toContain("baseline");
    expect(p).toContain("clear coaching reason supported by the computed facts");
  });

  it("decides with coaching judgment — the calendar is the default, freshness one signal among several (coaching-judgment brief, supersedes freshness-first)", () => {
    const p = recommendationSystemPrompt(facts, focuses, "Rest");
    expect(p).toContain("coaching judgment");
    expect(p).toContain("default recommendation");
    expect(p).toContain("only one factor");
    expect(p).not.toContain("FRESHNESS FIRST");
  });

  it("carries the 2026-07-07 incident guardrail: nothing recovered → rest/active recovery, never the overlapping plan", () => {
    const p = recommendationSystemPrompt(facts, focuses, "Rest");
    expect(p).toContain("GUARDRAIL");
    expect(p).toContain("NEVER the overlapping plan");
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
