import { getRecommendationMode, setRecommendationMode } from "@/lib/supabase/queries";
import { RECOMMENDATION_MODE_LABELS, RECOMMENDATION_MODES } from "@/lib/recommendation-mode";
import { SetRecommendationModeSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recommendation mode (feature brief: Adaptive Workout Planning). Authed by
 * middleware.ts like all /api/*.
 *
 * GET  /api/recommendation-mode — current mode + the pickable options (labels).
 * PUT  /api/recommendation-mode — set the active mode (follow | adapt | coach).
 *
 * This is CONTEXT, not program data — switching the mode does not mutate the
 * weekly program (ADR-0005). It changes how the card + chat compose the
 * recommendation and, via the cache fingerprint, forces a recompose on switch.
 */
export async function GET() {
  try {
    const mode = await getRecommendationMode();
    return ok({
      mode,
      options: RECOMMENDATION_MODES.map((m) => ({ mode: m, label: RECOMMENDATION_MODE_LABELS[m] })),
    });
  } catch (e) {
    return failFrom(e);
  }
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = SetRecommendationModeSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  try {
    await setRecommendationMode(parsed.data.mode);
    return ok({ mode: parsed.data.mode });
  } catch (e) {
    return failFrom(e);
  }
}
