/**
 * Session cookie helpers used by middleware.ts and /api/login.
 * Spec: tests/session.test.ts (all green).
 *
 * NOTE: originally the owner-written learning scope; AI-implemented 2026-07-05
 * at the owner's request — flagged for a teach-mode revisit (walkthrough, or
 * delete the bodies and re-derive against the tests).
 *
 * Design (project spec, business rule 9):
 *  - Cookie value: `<payload>.<signature>`, signature = HMAC-SHA256(payload, SESSION_SECRET), hex.
 *  - Payload: issued-at timestamp (ms). Expiry: 30 days.
 *  - Web Crypto (crypto.subtle) rather than node:crypto so the same code runs on
 *    the Edge runtime (middleware) and in Node (tests, route handlers).
 *  - Verification is timing-safe and never throws on malformed input.
 */

export const SESSION_COOKIE = "atw_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const encoder = new TextEncoder();

async function hmacHex(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Create a signed session token. */
export async function createSessionToken(secret: string, now?: number): Promise<string> {
  const payload = String(now ?? Date.now());
  return `${payload}.${await hmacHex(payload, secret)}`;
}

/** Verify a token: valid signature AND not expired. Never throws. */
export async function verifySessionToken(
  token: string | undefined,
  secret: string,
  now?: number,
): Promise<boolean> {
  try {
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    if (!/^\d+$/.test(payload)) return false;

    const expected = await hmacHex(payload, secret);
    if (!timingSafeEqualStr(sig, expected)) return false;

    const issuedAt = Number(payload);
    const age = (now ?? Date.now()) - issuedAt;
    return age <= SESSION_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Timing-safe string equality (used for the password check in /api/login and
 * signature comparison above). Constant-time over the longer input; the only
 * information leaked is length inequality, which is standard and acceptable.
 * Unlike node:crypto's timingSafeEqual, never throws on length mismatch.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (i < ab.length ? ab[i] : 0) ^ (i < bb.length ? bb[i] : 0);
  }
  return diff === 0;
}
