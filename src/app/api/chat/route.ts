import { openai } from "@/lib/openai/client";
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
 * ADR-0004 / rule 4: every number in the prompt comes from lib/facts; the system
 * prompt forbids the model from recomputing. ADR-0007: there is no stored program.
 * ADR-0008: recovery is model judgment from the muscle-recency facts, not a hard
 * computed gate. ADR-0009: the day's recommendation is a static suggestion — chat is
 * told what it says and whether the owner has ended the day, but never how much of it
 * is "left"; that derivation is retired.
 *
 * Answer format: streamed plain text, NOT JSON — streaming a JSON body would
 * forfeit the first-token latency target; /api/parse keeps the schema path.
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
    const nameById = new Map(ctx.exercises.map((e) => [e.id, e.name]));

    const factsBlock = buildFactsBlock({
      today: ctx.today,
      // Exact-time facts (workout-timing-sleep-state brief): hours are computed by
      // lib/facts off logged_at; the ambiguity flag gates the one sleep question.
      now: ctx.timing.now_clock,
      last_workout: ctx.timing.last_workout,
      sleep_state_ambiguous: ctx.timing.sleep_state_ambiguous,
      days_since_last_workout: ctx.days_since_last_workout,
      detraining: ctx.detraining,
      pr_bests: ctx.pr_bests.map((p) => ({
        exercise_name: p.exercise_name,
        is_bodyweight: p.is_bodyweight,
        unit: p.unit,
        best_reps: p.best_reps,
        best_weight: p.best_weight,
        achieved_on: p.achieved_on,
      })),
      next_pr_targets: ctx.next_targets.map((t) => ({
        exercise_name: nameById.get(t.exercise_id) ?? "unknown",
        target_reps: t.target_reps,
        target_weight: t.target_weight,
        rule_applied: t.rule_applied,
      })),
      history_summary: formatHistorySummary(ctx.recent_sessions),
      muscle_recency: ctx.muscle_recency.map((m) => ({ muscle_group: m.muscle_group, days_since: m.days_since })),
      // The day's pinned recommendation is injected as the advisory card suggestion
      // so chat sees what the home screen says without being bound to it.
      card_suggestion: ctx.pinned ? { headline: ctx.pinned.payload.headline, reason: ctx.pinned.payload.reason } : null,
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
