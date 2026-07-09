/**
 * Prompt builders — PURE functions (no server-only imports) so they're unit-testable.
 *
 * The facts block is the enforcement point of ADR-0004 (as amended by ADR-0007):
 * the model now ORIGINATES the workout (focus + lifts + sets + reps + weight), but
 * the deterministic signals it must not override are rendered here as GROUND TRUTH
 * and hard facts — progression targets (`nextPrTargets`) and the recovery-readiness
 * gate (`recoveryRecommended`). Dates, recency, and remaining counts remain computed
 * by lib/facts; the model never recomputes them.
 */

export interface FactsRemainingLine {
  exercise_name: string;
  unit: string;
  sets_remaining: number;
  sets_done: number;
  target_sets: number;
  target_reps: number | null; // null = AMRAP
  target_weight: number | null;
  rest_seconds: number | null;
  notes: string | null;
}

export interface FactsPrLine {
  exercise_name: string;
  is_bodyweight: boolean;
  unit: string;
  best_reps: number;
  best_weight: number | null;
  achieved_on: string;
}

export interface FactsNextTargetLine {
  exercise_name: string;
  target_reps: number;
  target_weight: number | null;
  rule_applied: "add_weight" | "add_reps";
}

export interface FactsMuscleRecencyLine {
  muscle_group: string;
  days_since: number;
}

export interface FactsCatalogLine {
  name: string;
  unit: string;
  is_bodyweight: boolean;
  muscle_groups: string[];
  default_rest_seconds: number | null;
  default_cue: string | null;
}

export interface FactsEquipment {
  name: string;
  items: string[];
}

export interface FactsBlockInput {
  today: string; // yyyy-mm-dd
  days_since_last_workout: number | null; // null = no history (Flow 4)
  detraining: boolean;
  /** What's left of today's recommendation (chat only); omit for the composer. */
  remaining?: FactsRemainingLine[];
  pr_bests: FactsPrLine[];
  next_pr_targets: FactsNextTargetLine[];
  history_summary: string; // preformatted, most recent first
  muscle_recency: FactsMuscleRecencyLine[]; // computed per-group recency
  /** Deterministic recovery gate (ADR-0007). Non-null = the app FORCES recovery. */
  recovery_required?: { reason: string } | null;
  /** The exercises the composer may program (with per-exercise rest/cue hints).
   *  Composer only — chat doesn't prescribe a fresh workout. */
  exercise_catalog?: FactsCatalogLine[];
  /** Today's pinned card suggestion — injected into chat as ADVISORY (what the home
   *  screen currently says), not ground truth. Chat only. */
  card_suggestion?: { headline: string; reason: string } | null;
  equipment: FactsEquipment | null; // active equipment profile, or null
}

function fmtWeight(weight: number | null, isBodyweight: boolean): string {
  if (isBodyweight) return weight != null && weight > 0 ? `BW +${weight} lbs` : "BW";
  return weight != null ? `${weight} lbs` : "—";
}

function fmtTarget(r: FactsRemainingLine): string {
  const reps = r.target_reps == null ? "max (AMRAP)" : `${r.target_reps} ${r.unit}`;
  const weight = r.target_weight != null ? ` @ ${r.target_weight} lbs` : "";
  const rest = r.rest_seconds != null ? `, rest ${r.rest_seconds}s` : "";
  const notes = r.notes ? ` — ${r.notes}` : "";
  return `${r.exercise_name}: ${r.sets_remaining} of ${r.target_sets} sets left × ${reps}${weight}${rest}${notes}`;
}

export function buildFactsBlock(f: FactsBlockInput): string {
  const lines: string[] = [];
  lines.push("=== FACTS — computed by the app. GROUND TRUTH. Never recompute or contradict. ===");
  lines.push(`Today: ${f.today}`);

  if (f.days_since_last_workout === null) {
    lines.push("Workout history: NONE — first run. No PRs, no recency data.");
  } else {
    lines.push(`Days since last workout: ${f.days_since_last_workout}`);
    lines.push(`Detraining mode (gap >= 14 days): ${f.detraining ? "YES" : "no"}`);
  }

  // Recovery gate (ADR-0007) — a HARD fact, not advice. Rendered prominently so
  // the composer/chat cannot miss it.
  if (f.recovery_required) {
    lines.push(`RECOVERY REQUIRED (computed): ${f.recovery_required.reason}`);
  }

  if (f.remaining) {
    if (f.remaining.length === 0) {
      lines.push("Remaining today: none — today's recommended work is complete.");
    } else {
      lines.push("Remaining today (exact, across AM/PM parts):");
      for (const r of f.remaining) lines.push(`- ${fmtTarget(r)}`);
    }
  }

  if (f.pr_bests.length > 0) {
    lines.push("Current PRs (per variation, derived from logged sets):");
    for (const p of f.pr_bests) {
      lines.push(
        `- ${p.exercise_name}: ${p.best_reps} ${p.unit} @ ${fmtWeight(p.best_weight, p.is_bodyweight)} (on ${p.achieved_on})`,
      );
    }
  }
  if (f.next_pr_targets.length > 0 && !f.detraining) {
    lines.push("Next PR targets (minimum overload, computed — the progression anchor):");
    for (const t of f.next_pr_targets) {
      const w = t.target_weight != null ? ` @ ${t.target_weight} lbs` : "";
      lines.push(`- ${t.exercise_name}: ${t.target_reps}${w} (${t.rule_applied === "add_weight" ? "+2.5 lbs" : "+1 rep"})`);
    }
  }
  if (f.muscle_recency.length > 0) {
    lines.push("Recently trained (by muscle group, computed — soonest first):");
    for (const m of f.muscle_recency) {
      const when = m.days_since === 0 ? "today" : `${m.days_since} day${m.days_since === 1 ? "" : "s"} ago`;
      lines.push(`- ${m.muscle_group}: ${when}`);
    }
  }
  if (f.exercise_catalog && f.exercise_catalog.length > 0) {
    lines.push("Available exercises (choose ONLY from these; rest/cue are defaults you may adjust):");
    for (const e of f.exercise_catalog) {
      const groups = e.muscle_groups.length > 0 ? e.muscle_groups.join(", ") : "cardio/none";
      const rest = e.default_rest_seconds != null ? `, rest ${e.default_rest_seconds}s` : "";
      const cue = e.default_cue ? `, cue: ${e.default_cue}` : "";
      lines.push(`- ${e.name} [${e.unit}, ${e.is_bodyweight ? "bodyweight" : "weighted"}] — ${groups}${rest}${cue}`);
    }
  }
  if (f.card_suggestion) {
    lines.push(
      `Today's card suggestion (app-generated recommendation on the home screen — ADVISORY, not ground truth): "${f.card_suggestion.headline}" — ${f.card_suggestion.reason}`,
    );
  }
  if (f.history_summary) {
    lines.push("Recent sessions (most recent first):");
    lines.push(f.history_summary);
  }
  if (f.equipment) {
    const items = f.equipment.items.length > 0 ? f.equipment.items.join(", ") : "bodyweight only";
    lines.push(`Available equipment (active profile "${f.equipment.name}"): ${items}`);
  }
  lines.push("=== END FACTS ===");
  return lines.join("\n");
}

export interface HistorySession {
  date: string;
  part: "am" | "pm" | null;
  sets: { exercise_name: string; reps: number; weight: number | null; unit: string; is_bodyweight: boolean }[];
}

/** Compact per-session lines: "2026-07-03: Deadlift 9/9/9/9 @32.5lbs · Plank 60/60/60s". */
export function formatHistorySummary(sessions: HistorySession[]): string {
  return sessions
    .map((s) => {
      const byExercise = new Map<string, { reps: number[]; weight: number | null; unit: string; bw: boolean }>();
      for (const set of s.sets) {
        const entry = byExercise.get(set.exercise_name) ?? {
          reps: [],
          weight: set.weight,
          unit: set.unit,
          bw: set.is_bodyweight,
        };
        entry.reps.push(set.reps);
        if (set.weight != null) entry.weight = set.weight;
        byExercise.set(set.exercise_name, entry);
      }
      const parts = [...byExercise.entries()].map(([name, e]) => {
        const unitSuffix = e.unit === "reps" ? "" : e.unit === "seconds" ? "s" : "min";
        const weight = e.weight != null ? ` @${e.weight}lbs${e.bw ? " added" : ""}` : "";
        return `${name} ${e.reps.join("/")}${unitSuffix}${weight}`;
      });
      return `${s.date}${s.part ? ` (${s.part})` : ""}: ${parts.join(" · ")}`;
    })
    .join("\n");
}

/**
 * System prompt for /api/chat (GPT-5.4) — the coaching composer, never the calculator.
 *
 * ADR-0007 regime: there is no stored program. The coach recommends what to train
 * today from history + recovery. Facts stay ground truth (ADR-0004); the deterministic
 * recovery gate and PR targets are hard facts; today's card suggestion is ADVISORY —
 * the model may disagree when the facts support a better recommendation.
 */
export function chatSystemPrompt(factsBlock: string): string {
  return [
    "You are the owner's personal strength coach inside their workout app.",
    "Your job is to recommend what the owner should actually train today based on the facts — their real training history and recovery. There is no fixed weekly plan; you decide the workout.",
    "",
    "NON-NEGOTIABLE RULES:",
    "The FACTS block below is generated by the app and is GROUND TRUTH. Never recompute, re-derive, or contradict: dates, workout history, days since last workout, remaining sets, PRs, PR targets, muscle-group recency, or available equipment. If your intuition disagrees with a fact, the fact wins.",
    "Today's card suggestion (if present) is a recommendation generated by the app, NOT ground truth. You may disagree with it if the facts support a better recommendation.",
    "",
    "RECOVERY GATE (HARD):",
    "If the FACTS include a 'RECOVERY REQUIRED (computed)' line, every muscle group was trained within the last day. Recommend rest or active recovery only — never a training focus that overlaps recovering muscles. This is a computed safety rule, not a preference.",
    "",
    "COACHING PHILOSOPHY:",
    "Act like an experienced strength coach. Coach the athlete, not the calendar. Use the workout history and muscle-group recency to decide what should be trained today. Missed days, extra workouts, and training out of order are completely normal. Recommend the workout that best matches the owner's recovery and progression.",
    "",
    "RECOVERY RULES:",
    "0-1 days since a muscle group was trained: not recovered — strongly avoid training the same primary muscle groups. 2 days: usually acceptable — prefer these muscles over anything trained yesterday. 3-5 days: recovered — excellent candidates for training. 6+ days: high priority unless another factor suggests otherwise.",
    "If multiple workouts are viable, prioritize: (1) the muscle groups trained least recently, (2) the workout that best balances weekly volume. When nothing is recovered, the answer is rest or active recovery, NEVER the overlapping plan — \"no fresher alternative\" is a reason to recover, not a license to hit the most-recently-trained muscles.",
    "",
    "PROGRESSION:",
    "When the facts include Next PR targets, treat them as the computed progression anchor: prescribe those loads/reps for a progression set, and never invent a bigger jump than the minimum overload shown.",
    "",
    "DETRAINING:",
    "If detraining mode is YES: reduce volume and intensity, no PR attempts, no PR-target discussion.",
    "",
    "FIRST RUN:",
    "If there is no workout history: answer generically and recommend logging today's workout to build future recommendations.",
    "",
    "EQUIPMENT:",
    "Only prescribe exercises supported by the available equipment; never assume equipment that isn't listed. If the user states different equipment in their question, that overrides the active profile for this answer. Provide equivalent substitutions whenever appropriate.",
    "",
    "WEIGHT SEMANTICS:",
    "For bodyweight movements, weight means ADDED load (\"BW +10\" = bodyweight plus 10 lbs). For BARBELL lifts, weight is the load PER SIDE (e.g. Squat 17.5 = 17.5 lbs per side); \"+2.5 lbs\" progression means per side (+5 lbs total). For DUMBBELL lifts, weight is PER HAND.",
    "",
    "OUTPUT STYLE:",
    "Keep answers concise and practical — this is read on a phone, mid-workout. Prioritize answering the user's question. When recommending training: explain why in one or two sentences, give exercises with sets × reps, weight, and rest time, and include one coaching cue if useful. Plain text only: short paragraphs and dash lists; no markdown headers or tables.",
    "",
    "DECISION PRIORITY:",
    "Always make decisions in this order: 1. workout history, 2. muscle recovery, 3. training balance, 4. available equipment, 5. user constraints, 6. today's card. Today's card is advisory only. Never invent facts — base every recommendation on the supplied facts.",
    "",
    factsBlock,
  ].join("\n");
}

/**
 * Behavioral version of `recommendationSystemPrompt` below. Folded into the
 * cache fingerprint (lib/facts `recommendationFingerprint`) so a prompt change
 * takes effect on deploy instead of serving the previous regime's cached card
 * until the next date rollover. Bump on any edit that changes what the model
 * would recommend (philosophy, rules, guardrails) — not on typo fixes.
 * v1 = freshness-first · v2 = coaching-judgment · v3 = scored candidates + graded
 * recovery heuristic · v4 = recommendation modes · v5 = ADR-0007: the model
 * originates the whole workout (focus + lifts + sets + reps + weight) from the
 * exercise catalog; program/modes/candidates retired; recovery-readiness is a
 * hard computed gate and PR targets are the progression anchor.
 */
export const RECOMMENDATION_PROMPT_VERSION = 5;

/**
 * System prompt for GET /api/recommendation (GPT-5.4-mini, Structured Outputs) —
 * the Today composer (ADR-0007). The model ORIGINATES today's workout: it names a
 * focus and composes the lifts, sets, reps, and weight, choosing exercises only
 * from the allowed catalog. The deterministic signals it must respect — the
 * recovery gate and PR targets — arrive in the facts block; it never recomputes
 * numbers the app already computed (dates, recency, PR targets).
 *
 * PURE: takes the already-built facts block + the allowed exercise names.
 */
export function recommendationSystemPrompt(factsBlock: string, allowedExercises: readonly string[]): string {
  return [
    "You are the owner's strength coach, composing today's recommended workout for the app's home screen — the first thing they see when they open the app.",
    "",
    "Your job is to decide what would make the best training decision TODAY based on the owner's recent training history and recovery, and to compose the actual workout: a focus, and the lifts with sets, reps, weight, rest, and an optional cue.",
    "",
    "GROUND TRUTH:",
    "The FACTS block below is computed by the application and is the source of truth. Never recompute or contradict any dates, day gaps, remaining sets, PR targets, or muscle-group recency. Every number you cite in the reason must come directly from the FACTS.",
    "",
    "RECOVERY GATE (HARD):",
    "If the FACTS include a 'RECOVERY REQUIRED (computed)' line, every muscle group was trained within the last day. You MUST return is_recovery = true with lifts = null (rest or active recovery) — never a training focus. This is a computed safety rule, not a preference.",
    "",
    "CHOOSING EXERCISES:",
    `Program ONLY exercises from this allowed list (use the name verbatim): ${allowedExercises.join(" | ")}`,
    "Only prescribe exercises supported by the available equipment in the FACTS; never assume equipment that isn't listed. Match each lift's unit and bodyweight nature to the catalog entry.",
    "",
    "PROGRESSION:",
    "When you program a lift that has a Next PR target in the FACTS, use that computed target as the progression anchor for its weight/reps — do not invent a larger jump than the minimum overload shown. If detraining mode is YES, reduce volume and intensity and make NO PR attempts.",
    "",
    "HOW TO DECIDE THE FOCUS:",
    "Review the complete FACTS block. Consider recent workout history, muscle-group recency, training balance, neglected muscle groups, and fatigue together. Recovery heuristic: 0-1 days since a muscle group was trained → strongly avoid it; 2 days → usually acceptable; 3-5 days → excellent; 6+ days → high priority. Prefer the least-recently-trained muscles. Look for patterns across multiple recent sessions, not just yesterday.",
    "",
    "WRITING STYLE:",
    "focus: a short label for the day — e.g. \"Pull\", \"Lower Body\", \"Chest + Back\", \"Active Recovery\".",
    "headline: one short line for a phone card — e.g. \"Suggested: Lower Body\" / \"Recovery First\".",
    "reason: one concise sentence explaining the coaching decision using only the computed facts — e.g. \"Legs are fully recovered while push work was only 2 days ago.\"",
    "Do not use markdown or bullet points. Output only the schema fields.",
    "",
    factsBlock,
  ].join("\n");
}

/** System prompt for /api/parse (GPT-5.4-mini, Structured Outputs) — extraction only, never advice. */
export function parseSystemPrompt(): string {
  return [
    "You extract workout log entries from the user's free text into the given JSON schema. Extraction only — no coaching, no corrections.",
    "",
    "Rules:",
    "- raw_name: the exercise name exactly as the user wrote it. Do NOT normalize, expand, or canonicalize — name resolution happens elsewhere.",
    '- "3x12" style means sets x reps. "12/12/11/10" means per-set reps — return the array.',
    "- weight_lbs: a number when the user states load; null when none is stated or the movement is plain bodyweight. \"+10\" or \"BW+10\" means added load: 10.",
    "- Durations: for time-based work (plank, walk, intervals), put the duration value in reps (the app knows the unit).",
    "- If you cannot extract at least one entry with sets and reps, return entries: [] with clarification_needed: true and ONE short clarifying question in clarification_question. Never guess numbers that are not there (a junk write is worse than a question).",
    "- If extraction succeeds, clarification_needed: false and clarification_question: null.",
  ].join("\n");
}
