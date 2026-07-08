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

  it("renders per-focus overlap facts at both levels + freshest-trained group (recency-first)", () => {
    const block = buildFactsBlock({
      ...base,
      focus_recency: [
        {
          label: "Upper — Chest + Back",
          groups: [
            { muscle_group: "chest", days_since: 1 },
            { muscle_group: "chest_mid", days_since: 1 },
            { muscle_group: "back_lats", days_since: null },
          ],
          freshest_overlap_days: 1,
        },
        { label: "Lower Body", groups: [{ muscle_group: "quads", days_since: 6 }], freshest_overlap_days: 6 },
      ],
    });
    expect(block).toContain("Focus options");
    expect(block).toContain("Upper — Chest + Back → chest 1d, chest_mid 1d, back_lats cold | freshest-trained group: 1d");
    expect(block).toContain("Lower Body → quads 6d | freshest-trained group: 6d");
  });

  it("renders a fully-cold focus as 'all cold' (first run / never trained)", () => {
    const block = buildFactsBlock({
      ...base,
      focus_recency: [{ label: "Rest", groups: [], freshest_overlap_days: null }],
    });
    expect(block).toContain("Rest → no tagged muscle groups | freshest-trained group: all cold");
  });

  it("omits the focus-options section entirely when there is none", () => {
    expect(buildFactsBlock(base)).not.toContain("Focus options");
  });

  it("renders today's card suggestion as ADVISORY so chat sees what the home screen says without being bound to it", () => {
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

  it("renders the scored candidate list as ADVISORY, ranked with per-candidate reasons", () => {
    const block = buildFactsBlock({
      ...base,
      candidates: [
        { label: "Push", score: 91, reasons: ["chest 3d", "shoulders 3d", "triceps cold"] },
        { label: "Lower Body", score: 86, reasons: ["quads 2d"] },
        { label: "Rest", score: 72, reasons: ["2 training days in the last 3 days"] },
      ],
    });
    expect(block).toContain("Candidate recommendations (app-scored 0-100 — ADVISORY recommendations, NOT ground truth");
    expect(block).toContain("- Push — 91 (chest 3d; shoulders 3d; triceps cold)");
    expect(block).toContain("- Lower Body — 86 (quads 2d)");
    expect(block).toContain("- Rest — 72 (2 training days in the last 3 days)");
  });

  it("omits the candidates section entirely when there are none", () => {
    expect(buildFactsBlock(base)).not.toContain("Candidate recommendations");
    expect(buildFactsBlock({ ...base, candidates: [] })).not.toContain("Candidate recommendations");
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

describe("chatSystemPrompt (coaching-judgment regime — chat aligned with the card composer)", () => {
  const block = buildFactsBlock(base);

  it("frames the job as coaching the athlete, not repeating the program", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("Your job is NOT to repeat today's program");
    expect(p).toContain("Coach the athlete, not the calendar");
    expect(p).toContain("a baseline, not a schedule that must be followed");
  });

  it("splits ground truth from advisory: program day, card suggestion, and candidates are recommendations the model may reject", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("GROUND TRUTH");
    expect(p).toContain("recommendations generated by the app, NOT ground truth");
    expect(p).toContain("today's program day, today's card suggestion, and the scored candidate recommendations");
  });

  it("drops the freshness-first regime and the card-consistency gag", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).not.toContain("FRESHNESS FIRST");
    expect(p).not.toContain("CARD CONSISTENCY");
  });

  it("candidates are advisory — the model may pick a lower-scoring option on the facts", () => {
    expect(chatSystemPrompt(block, "adapt")).toContain(
      "you are not required to select the highest-scoring candidate if another option is better supported by the facts",
    );
  });

  it("states the graded recovery windows (0-1 avoid / 2 acceptable / 3-5 excellent / 6+ high priority) and the tie-break order", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("0-1 days since a muscle group was trained: not recovered — strongly avoid");
    expect(p).toContain("2 days: usually acceptable — prefer these muscles over anything trained yesterday");
    expect(p).toContain("3-5 days: recovered — excellent candidates for training");
    expect(p).toContain("6+ days: high priority unless another factor suggests otherwise");
    expect(p).toContain("the scheduled program day only as the final tie-breaker");
  });

  it("nothing recovered means rest/active recovery, never the overlapping plan (2026-07-07 incident guardrail carried)", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("rest or active recovery, NEVER the overlapping plan");
    expect(p).toContain("a reason to recover");
  });

  it("forbids rest-by-default: never rest just because it is on today's card", () => {
    expect(chatSystemPrompt(block, "adapt")).toContain("Do NOT recommend rest simply because it is on today's card");
  });

  it("divergence is expected: explain briefly, no apology, never mention overriding the app", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("WHEN TO DIVERGE");
    expect(p).toContain("do not apologize");
    expect(p).toContain("do not mention that you are overriding the app");
  });

  it("fixes the decision priority order with the program and card advisory-only at the bottom", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain(
      "1. workout history, 2. muscle recovery, 3. training balance, 4. available equipment, 5. user constraints, 6. today's program, 7. today's card and candidates",
    );
    expect(p).toContain("Today's program and today's card are advisory only");
  });

  it("states the per-side barbell / per-hand dumbbell weight convention", () => {
    const p = chatSystemPrompt(block, "adapt");
    expect(p).toContain("PER SIDE");
    expect(p).toContain("PER HAND");
  });

  it("lets an in-question location override the active profile", () => {
    expect(chatSystemPrompt(block, "adapt")).toContain("overrides the active profile");
  });

  it("injects the active recommendation-mode directive (Adaptive Workout Planning)", () => {
    expect(chatSystemPrompt(block, "follow")).toContain("RECOMMENDATION MODE — FOLLOW PROGRAM");
    expect(chatSystemPrompt(block, "adapt")).toContain("RECOMMENDATION MODE — ADAPT PROGRAM");
    expect(chatSystemPrompt(block, "coach")).toContain("RECOMMENDATION MODE — COACH");
    // The mode is what governs divergence, not a fixed always-diverge rule.
    expect(chatSystemPrompt(block, "coach")).toContain("governed by the RECOMMENDATION MODE");
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
    const prompt = chatSystemPrompt(buildFactsBlock(base), "adapt");
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
