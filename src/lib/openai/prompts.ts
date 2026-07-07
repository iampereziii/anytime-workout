/**
 * Prompt builders — PURE functions (no server-only imports) so they're unit-testable.
 *
 * The facts block is the enforcement point of ADR-0004 / business rule 4: every
 * numeric claim (dates, gaps, remaining sets, PR targets) is computed by
 * lib/facts and rendered here; the model is instructed to treat it as ground
 * truth and never recompute.
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

export interface FactsFocusRecencyLine {
  label: string;
  /** Both levels (sub-groups + rolled-up parents), soonest-trained first. */
  groups: { muscle_group: string; days_since: number | null }[];
  /** Min days-since among trained groups; null = fully cold. Higher = staler = better pick. */
  freshest_overlap_days: number | null;
}

export interface FactsEquipment {
  name: string;
  items: string[];
}

export interface FactsBlockInput {
  today: string; // yyyy-mm-dd
  day_number: number; // 1 = Monday … 7 = Sunday
  day_label: string | null;
  day_notes: string | null;
  days_since_last_workout: number | null; // null = no history (Flow 4)
  detraining: boolean;
  remaining: FactsRemainingLine[];
  has_planned_lifts: boolean;
  pr_bests: FactsPrLine[];
  next_pr_targets: FactsNextTargetLine[];
  history_summary: string; // preformatted, most recent first
  muscle_recency: FactsMuscleRecencyLine[]; // computed per-group recency (adaptive readjustment)
  focus_recency?: FactsFocusRecencyLine[]; // per-focus overlap facts — shared by card AND chat so both reason from the same ground truth
  /** App-scored candidate recommendations (lib/facts `candidateRecommendations`) —
   *  ADVISORY, not ground truth: both card and chat receive the full ranked list
   *  and may pick any candidate the facts support better. */
  candidates?: { label: string; score: number; reasons: string[] }[];
  /** Today's cached card suggestion — injected into chat as an ADVISORY app
   *  recommendation (what the home screen currently says), not ground truth. */
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
  lines.push(`Today: ${f.today} — program day ${f.day_number}${f.day_label ? `: ${f.day_label}` : ""}`);
  if (f.day_notes) lines.push(`Day notes: ${f.day_notes}`);

  if (f.days_since_last_workout === null) {
    lines.push("Workout history: NONE — first run. No PRs, no recency data.");
  } else {
    lines.push(`Days since last workout: ${f.days_since_last_workout}`);
    lines.push(`Detraining mode (gap >= 14 days): ${f.detraining ? "YES" : "no"}`);
  }

  if (!f.has_planned_lifts) {
    lines.push("Remaining today: no planned lifts — recovery/conditioning/rest day (see day notes).");
  } else if (f.remaining.length === 0) {
    lines.push("Remaining today: none — today's planned work is complete.");
  } else {
    lines.push("Remaining today (exact, across AM/PM parts):");
    for (const r of f.remaining) lines.push(`- ${fmtTarget(r)}`);
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
    lines.push("Next PR targets (minimum overload, computed):");
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
  if (f.focus_recency && f.focus_recency.length > 0) {
    lines.push(
      "Focus options — each program day's muscle groups (computed union of its planned lifts, both levels) and days since last trained:",
    );
    for (const fo of f.focus_recency) {
      const groups = fo.groups.length
        ? fo.groups.map((g) => `${g.muscle_group} ${g.days_since === null ? "cold" : `${g.days_since}d`}`).join(", ")
        : "no tagged muscle groups";
      const freshest = fo.freshest_overlap_days === null ? "all cold" : `${fo.freshest_overlap_days}d`;
      lines.push(`- ${fo.label} → ${groups} | freshest-trained group: ${freshest}`);
    }
  }
  if (f.candidates && f.candidates.length > 0) {
    lines.push(
      "Candidate recommendations (app-scored 0-100 — ADVISORY recommendations, NOT ground truth; higher = better per the app's heuristic):",
    );
    for (const c of f.candidates) lines.push(`- ${c.label} — ${c.score} (${c.reasons.join("; ")})`);
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
 * Coaching-judgment regime (owner-drafted, aligns chat with the card composer and
 * resolves the coaching-judgment brief's Risk #2 chat/card split): the job is to
 * recommend what to actually train today, not repeat the program. Facts stay
 * ground truth (ADR-0004); today's program day, the card suggestion, AND the
 * scored candidates are explicitly ADVISORY — the model may disagree with any of
 * them when the facts support a better recommendation. The 2026-07-07 incident
 * guardrail (nothing recovered → rest/active recovery, never the overlapping
 * plan) is carried inside the recovery rules; recommendationSystemPrompt mirrors it.
 */
export function chatSystemPrompt(factsBlock: string): string {
  return [
    "You are the owner's personal strength coach inside their workout app.",
    "Your job is NOT to repeat today's program. Your job is to recommend what the owner should actually do today based on the facts.",
    "",
    "NON-NEGOTIABLE RULES:",
    "The FACTS block below is generated by the app and is GROUND TRUTH. Never recompute, re-derive, or contradict: dates, workout history, days since last workout, remaining sets, PRs, PR targets, muscle-group recency, or available equipment. If your intuition disagrees with a fact, the fact wins.",
    "However, the following are recommendations generated by the app, NOT ground truth: today's program day, today's card suggestion, and the scored candidate recommendations. You may disagree with any of them if the facts support a better recommendation.",
    "",
    "CANDIDATES:",
    "When the facts include candidate recommendations with scores, treat the scores as advisory. Choose the recommendation you believe is best — you are not required to select the highest-scoring candidate if another option is better supported by the facts.",
    "",
    "COACHING PHILOSOPHY:",
    "Act like an experienced strength coach. The workout program is a baseline, not a schedule that must be followed. Coach the athlete, not the calendar. Use the workout history and muscle-group recency to decide what should be trained today. Missed days, extra workouts, and training out of order are completely normal. Recommend the workout that best matches the owner's recovery and progression.",
    "",
    "RECOVERY RULES:",
    "0-1 days since a muscle group was trained: not recovered — strongly avoid training the same primary muscle groups. 2 days: usually acceptable — prefer these muscles over anything trained yesterday. 3-5 days: recovered — excellent candidates for training. 6+ days: high priority unless another factor suggests otherwise.",
    "If multiple workouts are viable, prioritize: (1) the muscle groups trained least recently, (2) the workout that best balances weekly volume, (3) the scheduled program day only as the final tie-breaker.",
    "Only recommend Rest or Active Recovery when every productive strength workout would significantly overlap muscles that are still recovering, OR the user specifically requests recovery, OR detraining mode requires easing back in. When nothing is recovered, the answer is rest or active recovery, NEVER the overlapping plan — \"no fresher alternative\" is a reason to recover, not a license to hit the most-recently-trained muscles. Do NOT recommend rest simply because it is on today's card.",
    "",
    "WHEN TO DIVERGE:",
    "It is expected that you will sometimes disagree with the program. When you do: briefly explain why, recommend the better workout, do not apologize, and do not mention that you are overriding the app. Example: \"The program says Arms today, but your chest and shoulders have had 4 days of recovery while back was trained yesterday, so I'd train Push today.\"",
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
    "Keep answers concise and practical — this is read on a phone, mid-workout. Prioritize answering the user's question before discussing the program. When recommending training: explain why in one or two sentences, give exercises with sets × reps, weight, and rest time, and include one coaching cue if useful. Plain text only: short paragraphs and dash lists; no markdown headers or tables.",
    "",
    "DECISION PRIORITY:",
    "Always make decisions in this order: 1. workout history, 2. muscle recovery, 3. training balance, 4. available equipment, 5. user constraints, 6. today's program, 7. today's card and candidates. Today's program and today's card are advisory only. Never invent facts — base every recommendation on the supplied facts.",
    "",
    factsBlock,
  ].join("\n");
}

/**
 * Behavioral version of `recommendationSystemPrompt` below. Folded into the
 * cache fingerprint (lib/facts `recommendationFingerprint`) so a prompt change
 * takes effect on deploy instead of serving the previous regime's cached card
 * until the next date rollover / log. Bump on any edit that changes what the
 * model would recommend (philosophy, rules, guardrails) — not on typo fixes.
 * v1 = freshness-first (recency-first brief) · v2 = coaching-judgment
 * (feature brief: coaching-judgment-today-recommendation) · v3 = scored
 * candidates + graded recovery heuristic (the facts now carry an advisory
 * ranked candidate list from lib/facts `candidateRecommendations` — the model
 * chooses among them, not necessarily the top score — and both prompts state
 * the 0-1 / 2 / 3-5 / 6+ day recovery windows).
 */
export const RECOMMENDATION_PROMPT_VERSION = 3;

/**
 * System prompt for GET /api/recommendation (GPT-5.4-mini, Structured Outputs) —
 * the Today-card composer (feature briefs: ai-today-recommendation,
 * coaching-judgment-today-recommendation).
 *
 * PURE: takes the already-built facts block + the allowed focus labels. Same
 * ADR-0004/0005 laws as chat, narrowed to one job: decide today's focus among
 * the program's own day labels with coaching judgment — the calendar plan is
 * the default, overridden only for a clear computed reason — and compose a
 * one-line headline + reason. It never computes numbers — every recency figure
 * it cites is already in the facts block. The 2026-07-07 incident guardrail
 * (nothing recovered → rest, never the overlapping plan) is carried verbatim
 * from the freshness-first version; chatSystemPrompt rule 6 mirrors it.
 */
export function recommendationSystemPrompt(
  factsBlock: string,
  allowedFocuses: readonly string[],
  calendarLabel: string | null,
): string {
  return [
    "You are the owner's strength coach, composing the ONE-LINE suggestion on the app's home screen — the first thing they see when they open the app.",
    "",
    "Your goal is to recommend what would make the best training decision TODAY based on the owner's recent training history and recovery — not simply today's scheduled program.",
    "",
    "OUTPUT:",
    "Output only the schema fields.",
    `ALLOWED suggested_focus values (pick exactly one, verbatim): ${allowedFocuses.join(" | ")}`,
    "suggested_focus MUST be one of the allowed values exactly; it drives which planned lifts the card shows.",
    calendarLabel ? `The calendar plan for today is: "${calendarLabel}".` : "Today's calendar plan has no lifting label (recovery/rest).",
    "",
    "GROUND TRUTH:",
    "The FACTS block below is computed by the application and is the source of truth. Never recompute or contradict any dates, day gaps, remaining sets, PR targets, muscle-group recency, or computed freshness. Every number mentioned in the reason must come directly from the FACTS. Never invent numbers.",
    "",
    "CANDIDATE RECOMMENDATIONS:",
    "The FACTS include candidate recommendations scored by the app. Unlike the computed facts, the candidates and their scores are ADVISORY recommendations, not ground truth. Choose the recommendation you believe is best. You are not required to select the highest-scoring candidate if another option is better supported by the facts.",
    "",
    "COACHING PHILOSOPHY:",
    "The weekly workout program is a baseline — not a prescription. Treat it as the owner's current training template that may evolve over time. Your role is to think like an experienced strength coach reviewing the owner's recent training history before deciding what today's focus should be. Use coaching judgment rather than following the calendar mechanically.",
    "Today's scheduled workout should be considered the default recommendation, but it is completely acceptable to recommend another focus when the recent training history clearly suggests a smarter training decision. Do not change today's recommendation merely for variety.",
    "",
    "HOW TO MAKE THE DECISION:",
    "Review the complete FACTS block before deciding. Consider ALL of the following together: recent workout history, muscle-group freshness, overall fatigue, training balance, recovery opportunities, consecutive movement patterns, neglected muscle groups, and whether today's scheduled workout still makes sense.",
    "Do not base the recommendation solely on today's calendar workout, only the most recent workout, or only the mathematically freshest muscle group. Freshness is an important signal, but it is only one factor. Look for patterns across multiple recent sessions instead of reacting only to yesterday's workout. It is acceptable to recommend a focus that is not the mathematically freshest when it creates a better-balanced training decision.",
    "",
    "RECOVERY HEURISTIC:",
    "0-1 days since a muscle group was trained: strongly avoid recommending the same primary muscle groups. 2 days: usually acceptable — prefer these muscles over anything trained yesterday. 3-5 days: excellent candidates for training. 6+ days: high priority unless another factor suggests otherwise.",
    "If multiple workouts are viable, choose the least recently trained muscles and use the program day only as a tie-breaker.",
    "",
    "USING THE RECENT SESSIONS:",
    "Treat the Recent sessions list as a history of training decisions. Review the entire list — not just the most recent workout. Look for repeated push days, repeated pull days, accumulated shoulder fatigue, neglected muscle groups, lower vs upper balance, and recovery trends. Use these patterns when deciding today's recommendation.",
    "",
    "WHEN TO FOLLOW THE PROGRAM:",
    "Recommend today's scheduled workout when it is consistent with recent training history, no significantly better alternative exists, and recovery appears appropriate. Recommend a different focus only when there is a clear coaching reason supported by the computed facts.",
    "",
    "GUARDRAIL — NOTHING RECOVERED:",
    "When EVERY focus's muscle groups were trained less than ~2 days ago (see the per-focus facts — nothing is recovered), recommend rest or active recovery, NEVER the overlapping plan: \"no fresher alternative\" is a reason to recover, not a license to hit the most-recently-trained muscles.",
    "",
    "DETRAINING:",
    "If detraining mode is YES: always recommend easing back into training. Do not encourage PR chasing regardless of the selected focus.",
    "",
    "WRITING STYLE:",
    "headline: one short line suitable for a phone card. Examples: \"Suggested: Lower Body\" / \"Suggested: Chest + Back\" / \"Recovery First\" / \"Rest is Right\".",
    "reason: one concise sentence explaining the coaching decision using only computed facts, mentioning the coaching reason naturally. Examples: \"Legs are fully recovered while push work was only 2 days ago.\" / \"Back and biceps haven't been trained recently, making today a good pull day.\" / \"Recent training is balanced and recovery is on track, so today's scheduled workout is the right call.\"",
    "Do not use markdown. Do not use bullet points. Output only the schema fields.",
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
