import { supabaseServer } from "@/lib/supabase/server";
import { SetActiveProfileSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Equipment profiles — the persistent location/equipment context for adaptive
 * readjustment (feature brief Risk #4). Authed by middleware.ts like all /api/*.
 *
 * GET  /api/equipment-profiles — list all profiles (Today-screen picker).
 * PUT  /api/equipment-profiles — set the active profile by id; exactly one active.
 *
 * This is CONTEXT data, not program data — switching the active profile does not
 * mutate the weekly program, so it stays inside the ADR-0005 boundary.
 */
export async function GET() {
  try {
    const sb = supabaseServer();
    const { data, error } = await sb
      .from("equipment_profiles")
      .select("id, name, items, is_active")
      .order("name");
    if (error) return fail("db_error", error.message, 500);
    return ok({ profiles: data });
  } catch (e) {
    return failFrom(e);
  }
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = SetActiveProfileSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  const { id } = parsed.data;
  try {
    const sb = supabaseServer();

    // Reject unknown ids rather than silently deactivating everything.
    const { data: target, error: findErr } = await sb
      .from("equipment_profiles")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (findErr) return fail("db_error", findErr.message, 500);
    if (!target) return fail("not_found", "No equipment profile with that id", 404);

    // Exactly one active: clear the rest, set this one. No transaction primitive
    // over supabase-js here, but the two writes are idempotent and the read path
    // tolerates zero-or-one active (treated as "no profile").
    const { error: clearErr } = await sb
      .from("equipment_profiles")
      .update({ is_active: false })
      .neq("id", id);
    if (clearErr) return fail("db_error", clearErr.message, 500);

    const { data, error: setErr } = await sb
      .from("equipment_profiles")
      .update({ is_active: true })
      .eq("id", id)
      .select("id, name, items, is_active")
      .single();
    if (setErr) return fail("db_error", setErr.message, 500);

    return ok({ profile: data });
  } catch (e) {
    return failFrom(e);
  }
}
