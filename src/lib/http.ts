import { NextResponse } from "next/server";

/**
 * The ONE place the API response shape lives (spec Conventions #5):
 * `{ data } | { error: { code, message } }` — no ad-hoc shapes, no stack traces.
 */

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Map an unknown thrown error to the fixed shape — message only, never a stack. */
export function failFrom(e: unknown) {
  const message = e instanceof Error ? e.message : "Something went wrong";
  return fail("internal", message, 500);
}
