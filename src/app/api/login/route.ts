import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, timingSafeEqualStr } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * POST /api/login — the only public API route (business rule 9).
 * Wired to the owner-written session helpers; works once those are implemented.
 */
export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!expected || !secret) {
    return NextResponse.json(
      { error: { code: "misconfigured", message: "APP_PASSWORD / SESSION_SECRET not set" } },
      { status: 500 },
    );
  }
  if (!password || !timingSafeEqualStr(password, expected)) {
    return NextResponse.json(
      { error: { code: "invalid_credentials", message: "Wrong password" } },
      { status: 401 },
    );
  }

  const token = await createSessionToken(secret);
  const isHttps = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  });
  return res;
}
