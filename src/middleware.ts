import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/**
 * The auth gate (challenge #4 / business rule 9) — the one choke point where a
 * leaked URL can't reach the OpenAI proxy. Covers pages AND /api/*.
 *
 * NOTE: originally the owner-written learning scope; AI-implemented 2026-07-05
 * at the owner's request — flagged for a teach-mode revisit.
 *
 * Runs on the Edge runtime — session helpers use Web Crypto for that reason.
 * Fails CLOSED: missing SESSION_SECRET blocks everything except /login.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/sw.js"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authed = secret ? await verifySessionToken(token, secret) : false;

  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Valid session required" } },
      { status: 401 },
    );
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals + static assets. /login and /api/login are
  // allowed INSIDE middleware() so the public list lives in one reviewable place.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)"],
};
