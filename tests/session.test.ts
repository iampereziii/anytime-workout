import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  createSessionToken,
  timingSafeEqualStr,
  verifySessionToken,
} from "@/lib/auth/session";

/**
 * GUIDE TESTS for the owner-written session helpers (challenge #4 / business rule 9).
 * Red until you implement src/lib/auth/session.ts.
 */

const SECRET = "test-secret-do-not-use";

describe("createSessionToken / verifySessionToken", () => {
  it("round-trips: a freshly created token verifies", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects a tampered payload (signature no longer matches)", async () => {
    const token = await createSessionToken(SECRET);
    const [payload, sig] = token.split(".");
    const tampered = `${Number(payload) - 1000}.${sig}`;
    expect(await verifySessionToken(tampered, SECRET)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("other-secret");
    expect(await verifySessionToken(token, SECRET)).toBe(false);
  });

  it("rejects expired tokens (issued > 30 days ago)", async () => {
    const now = Date.now();
    const issued = now - SESSION_TTL_MS - 1;
    const token = await createSessionToken(SECRET, issued);
    expect(await verifySessionToken(token, SECRET, now)).toBe(false);
  });

  it("never throws on malformed input — returns false", async () => {
    for (const junk of [undefined, "", "no-dot", "a.b.c", "..", "�.�"]) {
      expect(await verifySessionToken(junk as string | undefined, SECRET)).toBe(false);
    }
  });
});

describe("timingSafeEqualStr", () => {
  it("equal strings → true", () => {
    expect(timingSafeEqualStr("correct-horse", "correct-horse")).toBe(true);
  });
  it("different strings, same length → false", () => {
    expect(timingSafeEqualStr("correct-horse", "correct-h0rse")).toBe(false);
  });
  it("different lengths → false (and must not throw — timingSafeEqual throws on length mismatch if used naively)", () => {
    expect(timingSafeEqualStr("short", "much-longer-string")).toBe(false);
  });
});
