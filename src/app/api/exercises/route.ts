import type { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { ExerciseCreateSchema } from "@/lib/validators";
import { ok, fail, failFrom } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/exercises        — full canonical list (combobox initial state + offline cache).
 * GET /api/exercises?q=...  — trigram search via search_exercises RPC (name + exact alias,
 *     business rule 12). The RPC returns a broad candidate net (>0.15); the 0.5
 *     did-you-mean threshold is applied in app code (lib/exercises/dedup).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  try {
    const sb = supabaseServer();
    if (!q) {
      const { data, error } = await sb.from("exercises").select("*").order("name");
      if (error) return fail("db_error", error.message, 500);
      return ok({ exercises: data });
    }
    const { data, error } = await sb.rpc("search_exercises", { q });
    if (error) return fail("db_error", error.message, 500);
    return ok({ results: data });
  } catch (e) {
    return failFrom(e);
  }
}

/**
 * POST /api/exercises — create a canonical exercise.
 * The CLIENT must have shown (and the user dismissed) the did-you-mean check
 * before calling this (business rule 1 — never silent, never blocked). The
 * server's only guard is the case-insensitive unique name index.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = ExerciseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail("bad_request", parsed.error.issues.map((i) => i.message).join("; "), 400);
  }
  try {
    const sb = supabaseServer();
    const { data, error } = await sb.from("exercises").insert(parsed.data).select().single();
    if (error) {
      if (error.code === "23505") {
        return fail("duplicate_name", `An exercise named "${parsed.data.name}" already exists`, 409);
      }
      return fail("db_error", error.message, 500);
    }
    return ok({ exercise: data }, 201);
  } catch (e) {
    return failFrom(e);
  }
}
