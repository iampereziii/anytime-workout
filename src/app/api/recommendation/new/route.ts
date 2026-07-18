import { composeAndPin } from "@/lib/recommendation/compose";
import { toPayload, toTodayView } from "@/lib/recommendation/payload";
import { getRecommendationContext } from "@/lib/supabase/queries";
import { fail, failFrom, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/recommendation/new — the owner pulls a fresh workout (ADR-0009).
 *
 * Recomposes today and REPLACES the day's pin, relaxing ADR-0007 finding 4's all-day
 * immutability to "fixed until the owner explicitly asks for a new one." Safe now
 * only because nothing tracks remaining against the pin: there is no "N left" to jump
 * and no morning-sets bleed. The prior suggestion is discarded — suggestions aren't
 * records, logged sets are.
 *
 * Exactly ONE model call per press, and it is the only way to spend a model call on
 * the Today card after the day's first compose (cost — CLAUDE.md #5).
 *
 * Unlike GET, a failure here is a real error, not a silent fallback — the owner
 * pressed a button and is waiting on it. A failed re-roll leaves the existing pin
 * untouched (it is only overwritten after a successful compose), so the card keeps
 * showing the suggestion it had.
 *
 * A re-roll composes from the same muscle-recency facts and may well return recovery
 * again — recovery is model judgment (ADR-0008); there is no force-non-recovery.
 */
export async function POST() {
  try {
    const ctx = await getRecommendationContext();
    const rec = await composeAndPin(ctx, { overwrite: true });
    if (!rec) return fail("unavailable", "Couldn't compose a new recommendation — try again.", 503);

    return ok({ recommendation: toPayload(rec), today: toTodayView(ctx.base) });
  } catch (e) {
    return failFrom(e);
  }
}
