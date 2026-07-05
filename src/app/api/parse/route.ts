import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/openai/client";
import { PARSE_MODEL } from "@/lib/openai/models";
import { parseSystemPrompt } from "@/lib/openai/prompts";
import { ParsedLogSchema } from "@/lib/openai/schemas";
import { ParseRequestSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/parse — free-text log → GPT-5.4-mini with ParsedLogSchema
 * Structured Outputs (challenge #7: schema-guaranteed JSON, never re-parsed
 * free-form text).
 *
 * Returns PROPOSED entries only — this route never persists (business rule 5).
 * raw_name → canonical-ID resolution happens client-side through the SAME
 * dedup confirm flow as the combobox (business rule 2 — one brain, two doors).
 * Ambiguous input → entries: [] + clarification_needed + ONE question.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ParseRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }

  try {
    const response = await openai().responses.parse({
      model: PARSE_MODEL,
      instructions: parseSystemPrompt(),
      input: parsed.data.text,
      text: { format: zodTextFormat(ParsedLogSchema, "parsed_log") },
    });

    if (!response.output_parsed) {
      return fail("parse_failed", "The model returned no parseable output — try rephrasing", 502);
    }
    return ok({ parsed: response.output_parsed });
  } catch (e) {
    return failFrom(e);
  }
}
