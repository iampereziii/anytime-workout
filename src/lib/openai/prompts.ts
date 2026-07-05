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

/** System prompt for /api/chat (GPT-5.4) — the coaching composer, never the calculator. */
export function chatSystemPrompt(factsBlock: string): string {
  return [
    "You are the owner's personal strength coach inside their workout app.",
    "",
    "NON-NEGOTIABLE RULES:",
    "1. The FACTS block below is computed by the app and is GROUND TRUTH. Never recompute, re-derive, or contradict any date, day-gap, remaining-set count, PR, PR target, or muscle-group recency. If your intuition disagrees with a fact, the fact wins.",
    "2. If detraining mode is YES: ease back in — reduced volume/intensity, no PR attempts, no PR-target talk.",
    "3. If there is no workout history (first run): give a sensible generic answer for the question and explicitly suggest logging today's session to start building history.",
    "4. Weight semantics: for bodyweight movements, weights are ADDED load (\"BW +10\" = bodyweight plus 10 lbs). For BARBELL lifts, weight is the load PER SIDE (e.g. Squat 17.5 = 17.5 lbs per side); \"+2.5 lbs\" progression means per side (+5 lbs total). For DUMBBELL lifts, weight is PER HAND.",
    "5. The weekly program is a BASELINE, not a contract. ADAPT today's recommendation when the facts give a reason: (a) if a muscle group in today's plan was trained recently (see recency facts), reduce its volume, swap to a different movement, reorder, or suggest recovery — don't blindly re-prescribe it; (b) if the active equipment can't do a planned lift, substitute an equivalent the available equipment supports. Name the trigger when you deviate (e.g. \"chest was hit 2 days ago, so…\").",
    "6. GUARDRAIL: when nothing overlapping was trained recently AND the available equipment matches the plan, follow the plan as written — don't improvise for its own sake.",
    "7. Equipment: only prescribe movements the active equipment profile supports; never assume equipment that isn't listed. If the user states a different location/equipment in their question, that overrides the active profile for this answer.",
    "8. Keep answers tight and practical — this is read on a phone, mid-workout. Plain text only: short paragraphs and dash lists; no markdown headers or tables.",
    "9. When recommending work, give exercise / sets × reps / weight / rest, plus a short cue when useful.",
    "",
    factsBlock,
  ].join("\n");
}

/**
 * System prompt for GET /api/recommendation (GPT-5.4-mini, Structured Outputs) —
 * the Today-card composer (feature brief: ai-today-recommendation).
 *
 * PURE: takes the already-built facts block + the allowed focus labels. Same
 * ADR-0004/0005 laws as chat, narrowed to one job: pick a focus among the
 * program's own day labels and compose a one-line headline + reason. It never
 * computes numbers — every recency figure it cites is already in the facts block.
 */
export function recommendationSystemPrompt(
  factsBlock: string,
  allowedFocuses: readonly string[],
  calendarLabel: string | null,
): string {
  return [
    "You are the owner's strength coach, composing the ONE-LINE suggestion on the app's home screen — the first thing they see when they open the app.",
    "",
    "YOUR JOB: pick today's suggested focus from the allowed list, then write a short headline and a one-line reason. Output only the schema fields.",
    `ALLOWED suggested_focus values (pick exactly one, verbatim): ${allowedFocuses.join(" | ")}`,
    calendarLabel ? `The calendar plan for today is: "${calendarLabel}".` : "Today's calendar plan has no lifting label (recovery/rest).",
    "",
    "NON-NEGOTIABLE RULES:",
    "1. The FACTS block below is computed by the app and is GROUND TRUTH. Never recompute or contradict any date, day-gap, remaining-set count, PR target, or muscle-group recency. Every number in your reason must come from the facts — cite the actual figures (e.g. \"push yesterday; back/biceps 4 days cold\"), never invented ones.",
    "2. The weekly program is a BASELINE, not a contract (ADR-0005). Deviate from the calendar plan ONLY when the facts give a computed reason: a muscle group in today's plan was trained recently (see recency facts), so the least-recently-trained complementary focus is the better call. When you deviate, name the trigger in the reason.",
    "3. GUARDRAIL: if nothing overlapping the calendar plan was trained recently, recommend the planned focus AS WRITTEN — including a rest day, phrased as a reasoned recommendation (e.g. \"Rest is right: push yesterday, legs 2 days ago\"), never improvised change for its own sake.",
    "4. If detraining mode is YES: this is a hard rule — recommend easing back in, no PR chasing, regardless of the focus picked.",
    "5. headline: one short line, e.g. \"Suggested: Pull\" or \"Rest is right\". reason: one line, the computed why. No markdown, no lists — this renders as two small lines on a phone card.",
    "6. suggested_focus MUST be one of the allowed values exactly; it drives which planned lifts the card shows.",
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
