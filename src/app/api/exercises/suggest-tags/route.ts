import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/openai/client";
import { TAG_SUGGEST_MODEL } from "@/lib/openai/models";
import { suggestTagsSystemPrompt } from "@/lib/openai/prompts";
import { SuggestedTagsSchema } from "@/lib/openai/schemas";
import { SuggestTagsRequestSchema } from "@/lib/validators";
import { MUSCLE_GROUP_VOCABULARY, isValidMuscleGroup } from "@/lib/muscle-groups";
import { ok, fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Give up on the model quickly — the create sheet is fully usable with an empty
 * picker, so a slow suggestion is simply dropped (brief: graceful absence). Tunable.
 */
const MODEL_TIMEOUT_MS = 4000;

/**
 * POST /api/exercises/suggest-tags — body `{ name }` → `{ muscle_groups: string[] }`.
 *
 * Mirror of the /api/parse shape (mini + Structured Outputs): the model PROPOSES the
 * muscle groups a new exercise trains; the owner confirms them in the picker before
 * anything is saved (ADR-0004 division of labor). This route NEVER persists — it only
 * pre-fills the create sheet.
 *
 * Output is constrained to MUSCLE_GROUP_VOCABULARY at the schema boundary
 * (SuggestedTagsSchema) AND re-validated + de-duplicated here, so a hallucinated group
 * can never reach the client or the DB. Empty is a valid answer (cardio/mobility).
 *
 * Graceful absence (AC): timeout / failure → the client treats the result as empty and
 * the create flow is byte-for-byte today's behavior. No error is surfaced to the user.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = SuggestTagsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }

  try {
    const response = await openai().responses.parse(
      {
        model: TAG_SUGGEST_MODEL,
        instructions: suggestTagsSystemPrompt(MUSCLE_GROUP_VOCABULARY),
        input: parsed.data.name,
        text: { format: zodTextFormat(SuggestedTagsSchema, "suggested_tags") },
      },
      { timeout: MODEL_TIMEOUT_MS },
    );

    // Structured Outputs already constrains to the vocabulary enum; re-validate and
    // de-dupe as the final server-side gate before any tag reaches the client.
    const suggested = response.output_parsed?.muscle_groups ?? [];
    const muscle_groups = [...new Set(suggested.filter(isValidMuscleGroup))];
    return ok({ muscle_groups });
  } catch (e) {
    return failFrom(e);
  }
}
