import { openai } from "@/lib/openai/client";
import { focusRecency } from "@/lib/facts";
import { RECOMMENDATION_MODEL } from "@/lib/openai/models";
import { buildFactsBlock, chatSystemPrompt, formatHistorySummary } from "@/lib/openai/prompts";
import { getChatContext } from "@/lib/supabase/queries";
import { ChatRequestSchema } from "@/lib/validators";
import { fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat — question + recent turns → facts block + history summary →
 * GPT-5.4, streamed as plain text (NFR: < 2s to first token).
 *
 * ADR-0002: grounding is prompt-stuffed (facts + compact history), not tool-use.
 * ADR-0004 / rule 4: every number in the prompt comes from lib/facts; the
 * system prompt forbids the model from recomputing.
 *
 * Answer format: streamed plain text, NOT RecommendationSchema JSON — streaming
 * a JSON body would forfeit the first-token latency target, and challenge #7's
 * Structured Outputs requirement covers JSON the app re-consumes (which chat
 * answers are not; they render as text). /api/parse keeps the schema path.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  const { question, history } = parsed.data;

  try {
    const ctx = await getChatContext();
    const exerciseNames = new Map(ctx.exercises.map((e) => [e.id, e.name]));
    const plannedById = new Map(ctx.planned.map((p) => [p.id, p]));

    const factsBlock = buildFactsBlock({
      today: ctx.today,
      day_number: ctx.day_number,
      day_label: ctx.day?.label ?? null,
      day_notes: ctx.day?.notes ?? null,
      days_since_last_workout: ctx.days_since_last_workout,
      detraining: ctx.detraining,
      has_planned_lifts: ctx.planned.length > 0,
      remaining: ctx.remaining.map((r) => {
        const p = plannedById.get(r.planned.id);
        return {
          exercise_name: p?.exercise.name ?? exerciseNames.get(r.planned.exercise_id) ?? "unknown",
          unit: p?.exercise.unit ?? "reps",
          sets_remaining: r.setsRemaining,
          sets_done: r.setsDone,
          target_sets: r.planned.target_sets,
          target_reps: r.planned.target_reps,
          target_weight: r.planned.target_weight,
          rest_seconds: r.planned.rest_seconds,
          notes: r.planned.notes,
        };
      }),
      pr_bests: ctx.pr_bests.map((p) => ({
        exercise_name: p.exercise_name,
        is_bodyweight: p.is_bodyweight,
        unit: p.unit,
        best_reps: p.best_reps,
        best_weight: p.best_weight,
        achieved_on: p.achieved_on,
      })),
      next_pr_targets: ctx.next_targets.map((t) => ({
        exercise_name: exerciseNames.get(t.exercise_id) ?? "unknown",
        target_reps: t.target_reps,
        target_weight: t.target_weight,
        rule_applied: t.rule_applied,
      })),
      history_summary: formatHistorySummary(ctx.recent_sessions),
      muscle_recency: ctx.muscle_recency.map((m) => ({
        muscle_group: m.muscle_group,
        days_since: m.days_since,
      })),
      // Same per-focus overlap facts the card picks on + the card's own suggestion
      // (recency-first brief): card and chat reason from shared ground truth, so
      // they can't disagree on plan-vs-freshness for the same facts (AC #7).
      focus_recency: focusRecency(ctx.program_days, ctx.muscle_recency),
      card_suggestion: ctx.card_suggestion,
      equipment: ctx.equipment,
    });

    const events = await openai().responses.create({
      model: RECOMMENDATION_MODEL,
      instructions: chatSystemPrompt(factsBlock),
      input: [...history, { role: "user" as const, content: question }],
      stream: true,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of events) {
            if (event.type === "response.output_text.delta") {
              controller.enqueue(encoder.encode(event.delta));
            }
          }
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (e) {
    return failFrom(e);
  }
}
