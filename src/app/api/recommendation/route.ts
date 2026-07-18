import { composeAndPin } from "@/lib/recommendation/compose";
import { toPayload, toTodayView } from "@/lib/recommendation/payload";
import { getRecommendationContext, type TodayContext } from "@/lib/supabase/queries";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recommendation — the sole Today surface (ADR-0007). The AI generates the
 * full workout (focus + lifts + sets + reps + weight); progression targets stay
 * deterministic and are fed as hard facts.
 *
 * The recommendation is a STATIC SUGGESTION (ADR-0009): the payload carries the
 * composed targets and says nothing about progress against them. Logging a set
 * changes history and PRs, never this response.
 *
 * Pinned per calendar day: composed once on the first load of the day (insert-if-
 * absent), reused by every later load — zero model calls on a plain reload. The pin
 * is no longer immutable-all-day (ADR-0009 relaxes finding 4): POST /new overwrites
 * it on request. A date rollover is a natural recompose — tomorrow starts fresh.
 *
 * Recovery is model judgment (ADR-0008): there is no deterministic gate. On a pin
 * miss the model always composes and may return is_recovery = true on its own
 * reading of the muscle-recency facts.
 *
 * Graceful fallback (AC #5): ANY failure returns `{ recommendation: null }` with 200.
 * Failures are never pinned (only a real composition is).
 */
export async function GET() {
  let base: TodayContext | undefined;
  try {
    const ctx = await getRecommendationContext();
    base = ctx.base;

    // Cache hit → the day is already pinned. Zero model calls.
    const rec = ctx.pinned?.payload ?? (await composeAndPin(ctx, { overwrite: false }));
    if (!rec) return ok({ recommendation: null, today: toTodayView(base) });

    return ok({ recommendation: toPayload(rec), today: toTodayView(base) });
  } catch {
    // Any failure → graceful fallback. If the base facts loaded before the failure
    // (e.g. only the model call failed), still return them so the card renders
    // recency with no header crash; a total failure returns nulls (offline state).
    return ok({ recommendation: null, today: base ? toTodayView(base) : null });
  }
}
