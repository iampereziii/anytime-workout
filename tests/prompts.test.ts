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
 * ADR-0007: no stored program; recovery gate is a hard computed fact.
 */

const base: FactsBlockInput = {
  today: "2026-07-05",
  days_since_last_workout: 2,
  detraining: false,
  pr_bests: [],
  next_pr_targets: [],
  history_summary: "",
  muscle_recency: [],
  equipment: null,
};

describe("buildFactsBlock (rule 4 — every number is computed, none inferred)", () => {
  it("renders today and the computed day-gap as ground truth", () => {
    const block = buildFactsBlock(base);
    expect(block).toContain("Today: 2026-07-05");
    expect(block).toContain("Days since last workout: 2");
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

  it("omits the remaining section entirely when no recommendation is pinned", () => {
    expect(buildFactsBlock(base)).not.toContain("Remaining today");
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

  it("renders PR targets as the progression anchor otherwise", () => {
    const block = buildFactsBlock({
      ...base,
      next_pr_targets: [{ exercise_name: "Squat", target_reps: 14, target_weight: 20, rule_applied: "add_weight" }],
    });
    expect(block).toContain("Next PR targets (minimum overload, computed — the progression anchor):");
  });

  it("AMRAP targets render as max, not a fabricated number", () => {
    const block = buildFactsBlock({
      ...base,
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
    expect(buildFactsBlock(base)).not.toContain("Recently trained (by muscle group");
  });

  it("renders the recovery gate as a HARD computed fact when required (ADR-0007)", () => {
    const block = buildFactsBlock({ ...base, recovery_required: { reason: "every muscle group was trained within the last day" } });
    expect(block).toContain("RECOVERY REQUIRED (computed): every muscle group was trained within the last day");
  });

  it("omits the recovery line when recovery is not required", () => {
    expect(buildFactsBlock({ ...base, recovery_required: null })).not.toContain("RECOVERY REQUIRED");
  });

  it("renders the allowed exercise catalog with rest/cue hints (composer only)", () => {
    const block = buildFactsBlock({
      ...base,
      exercise_catalog: [
        { name: "Squat", unit: "reps", is_bodyweight: false, muscle_groups: ["quads", "glutes"], default_rest_seconds: 120, default_cue: null },
        { name: "Plank", unit: "seconds", is_bodyweight: true, muscle_groups: ["core"], default_rest_seconds: 60, default_cue: "brace" },
      ],
    });
    expect(block).toContain("Available exercises (choose ONLY from these");
    expect(block).toContain("Squat [reps, weighted] — quads, glutes, rest 120s");
    expect(block).toContain("Plank [seconds, bodyweight] — core, rest 60s, cue: brace");
  });

  it("omits the catalog section when none is provided (chat path)", () => {
    expect(buildFactsBlock(base)).not.toContain("Available exercises");
  });

  it("renders today's card suggestion as ADVISORY so chat sees what the home screen says", () => {
    const block = buildFactsBlock({
      ...base,
      card_suggestion: { headline: "Suggested: Recovery", reason: "Lower body is only 1 day cold" },
    });
    expect(block).toContain(
      'Today\'s card suggestion (app-generated recommendation on the home screen — ADVISORY, not ground truth): "Suggested: Recovery" — Lower body is only 1 day cold',
    );
  });

  it("omits the card-suggestion line when no card has been composed yet", () => {
    expect(buildFactsBlock({ ...base, card_suggestion: null })).not.toContain("card suggestion");
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

describe("chatSystemPrompt (ADR-0007 coaching regime — no stored program)", () => {
  const block = buildFactsBlock(base);

  it("frames the job as coaching the athlete, with no fixed weekly plan", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("recommend what the owner should actually train today");
    expect(p).toContain("There is no fixed weekly plan");
    expect(p).toContain("Coach the athlete, not the calendar");
  });

  it("splits ground truth from advisory: the card suggestion is a recommendation the model may reject", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("GROUND TRUTH");
    expect(p).toContain("Today's card suggestion (if present) is a recommendation generated by the app, NOT ground truth");
  });

  it("carries the hard recovery gate (ADR-0007 finding 2)", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("RECOVERY GATE (HARD)");
    expect(p).toContain("RECOVERY REQUIRED (computed)");
  });

  it("states the graded recovery windows and the nothing-recovered guardrail", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("0-1 days since a muscle group was trained: not recovered — strongly avoid");
    expect(p).toContain("3-5 days: recovered — excellent candidates for training");
    expect(p).toContain("6+ days: high priority unless another factor suggests otherwise");
    expect(p).toContain("rest or active recovery, NEVER the overlapping plan");
  });

  it("treats computed PR targets as the progression anchor", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("PROGRESSION");
    expect(p).toContain("progression anchor");
  });

  it("states the per-side barbell / per-hand dumbbell weight convention", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain("PER SIDE");
    expect(p).toContain("PER HAND");
  });

  it("lets an in-question location override the active profile", () => {
    expect(chatSystemPrompt(block)).toContain("overrides the active profile");
  });

  it("fixes the decision priority with the card advisory-only at the bottom", () => {
    const p = chatSystemPrompt(block);
    expect(p).toContain(
      "1. workout history, 2. muscle recovery, 3. training balance, 4. available equipment, 5. user constraints, 6. today's card",
    );
    expect(p).toContain("Today's card is advisory only");
  });

  it("has no retired recommendation-mode language", () => {
    expect(chatSystemPrompt(block)).not.toContain("RECOMMENDATION MODE");
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
