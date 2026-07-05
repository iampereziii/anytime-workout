import { describe, expect, it } from "vitest";
import {
  buildFactsBlock,
  chatSystemPrompt,
  formatHistorySummary,
  parseSystemPrompt,
  type FactsBlockInput,
} from "@/lib/openai/prompts";

/**
 * Business rules 4 (facts are ground truth), 5 (clarify, never guess),
 * 6 (detraining) and Flow 4 (first run) — as they appear in the prompts.
 */

const base: FactsBlockInput = {
  today: "2026-07-05",
  day_number: 7,
  day_label: "Rest",
  day_notes: "Full rest — recovery",
  days_since_last_workout: 2,
  detraining: false,
  has_planned_lifts: false,
  remaining: [],
  pr_bests: [],
  next_pr_targets: [],
  history_summary: "",
  muscle_recency: [],
  equipment: null,
};

describe("buildFactsBlock (rule 4 — every number is computed, none inferred)", () => {
  it("renders the exact computed day-gap and program day", () => {
    const block = buildFactsBlock(base);
    expect(block).toContain("Days since last workout: 2");
    expect(block).toContain("program day 7: Rest");
    expect(block).toContain("GROUND TRUTH");
  });

  it("flags detraining mode explicitly (rule 6)", () => {
    const block = buildFactsBlock({ ...base, days_since_last_workout: 15, detraining: true });
    expect(block).toContain("Detraining mode (gap >= 14 days): YES");
  });

  it("first run: states there is NO history (Flow 4)", () => {
    const block = buildFactsBlock({ ...base, days_since_last_workout: null });
    expect(block).toContain("NONE — first run");
    expect(block).not.toContain("Days since last workout:");
  });

  it("renders exact remaining sets across AM/PM parts (rule 7)", () => {
    const block = buildFactsBlock({
      ...base,
      has_planned_lifts: true,
      remaining: [
        {
          exercise_name: "Barbell Row",
          unit: "reps",
          sets_remaining: 2,
          sets_done: 2,
          target_sets: 4,
          target_reps: 12,
          target_weight: 32.5,
          rest_seconds: 180,
          notes: "slow",
        },
      ],
    });
    expect(block).toContain("Barbell Row: 2 of 4 sets left × 12 reps @ 32.5 lbs, rest 180s — slow");
  });

  it("suppresses PR targets while detraining (rule 6 — no PR chasing)", () => {
    const block = buildFactsBlock({
      ...base,
      detraining: true,
      days_since_last_workout: 20,
      next_pr_targets: [{ exercise_name: "Squat", target_reps: 14, target_weight: 20, rule_applied: "add_weight" }],
    });
    expect(block).not.toContain("Next PR targets");
  });

  it("AMRAP targets render as max, not a fabricated number", () => {
    const block = buildFactsBlock({
      ...base,
      has_planned_lifts: true,
      remaining: [
        {
          exercise_name: "Push-up",
          unit: "reps",
          sets_remaining: 3,
          sets_done: 0,
          target_sets: 3,
          target_reps: null,
          target_weight: null,
          rest_seconds: 120,
          notes: null,
        },
      ],
    });
    expect(block).toContain("max (AMRAP)");
  });

  it("renders computed per-muscle-group recency (adaptive readjustment)", () => {
    const block = buildFactsBlock({
      ...base,
      muscle_recency: [
        { muscle_group: "chest", days_since: 2 },
        { muscle_group: "quads", days_since: 0 },
      ],
    });
    expect(block).toContain("Recently trained (by muscle group");
    expect(block).toContain("chest: 2 days ago");
    expect(block).toContain("quads: today");
  });

  it("omits the recency section entirely when there is none", () => {
    const block = buildFactsBlock(base);
    expect(block).not.toContain("Recently trained (by muscle group");
  });

  it("lists the active equipment profile and its items", () => {
    const block = buildFactsBlock({
      ...base,
      equipment: { name: "Home", items: ["barbell", "dumbbells", "pull-up bar", "plates"] },
    });
    expect(block).toContain('Available equipment (active profile "Home"): barbell, dumbbells, pull-up bar, plates');
  });

  it("renders an empty equipment profile as bodyweight only", () => {
    const block = buildFactsBlock({ ...base, equipment: { name: "Hotel", items: [] } });
    expect(block).toContain('Available equipment (active profile "Hotel"): bodyweight only');
  });
});

describe("chatSystemPrompt (adaptive readjustment rules)", () => {
  const block = buildFactsBlock(base);

  it("frames the program as a baseline, not a contract", () => {
    expect(chatSystemPrompt(block)).toContain("BASELINE, not a contract");
  });

  it("carries the guardrail: follow the plan when nothing triggers adaptation", () => {
    expect(chatSystemPrompt(block)).toContain("GUARDRAIL");
  });

  it("states the per-side barbell / per-hand dumbbell weight convention", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("PER SIDE");
    expect(p).toContain("PER HAND");
  });

  it("lets an in-question location override the active profile", () => {
    expect(chatSystemPrompt(block)).toContain("overrides the active profile");
  });
});

describe("formatHistorySummary", () => {
  it("compacts a session into per-exercise rep runs with load", () => {
    const summary = formatHistorySummary([
      {
        date: "2026-07-03",
        part: null,
        sets: [
          { exercise_name: "Deadlift", reps: 9, weight: 32.5, unit: "reps", is_bodyweight: false },
          { exercise_name: "Deadlift", reps: 9, weight: 32.5, unit: "reps", is_bodyweight: false },
          { exercise_name: "Plank", reps: 60, weight: null, unit: "seconds", is_bodyweight: true },
        ],
      },
    ]);
    expect(summary).toBe("2026-07-03: Deadlift 9/9 @32.5lbs · Plank 60s");
  });

  it("marks split-session parts (Flow 7)", () => {
    const summary = formatHistorySummary([
      {
        date: "2026-07-02",
        part: "am",
        sets: [{ exercise_name: "Squat", reps: 14, weight: 17.5, unit: "reps", is_bodyweight: false }],
      },
    ]);
    expect(summary).toContain("2026-07-02 (am):");
  });
});

describe("system prompts", () => {
  it("chat prompt forbids recomputing facts (rule 4) and embeds the block", () => {
    const prompt = chatSystemPrompt(buildFactsBlock(base));
    expect(prompt).toContain("Never recompute");
    expect(prompt).toContain("=== FACTS");
    expect(prompt).toContain("detraining");
  });

  it("parse prompt demands ONE clarifying question over guessing (rule 5)", () => {
    const prompt = parseSystemPrompt();
    expect(prompt).toContain("clarification_needed: true");
    expect(prompt).toContain("Never guess");
  });

  it("parse prompt forbids normalizing names — resolution belongs to the dedup brain (rule 2)", () => {
    expect(parseSystemPrompt()).toContain("Do NOT normalize");
  });
});
