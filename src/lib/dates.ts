/**
 * Date helpers with LOCAL-day semantics — sessions and program days are
 * anchored to the user's local calendar day, never UTC.
 */

/**
 * Program day convention: 1 = Monday … 7 = Sunday.
 * Anchored by the seed baseline week (2026-06-29, a Monday, is Day 1).
 */
export function dayNumberFor(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/** Local date N days before `from`, as yyyy-mm-dd (backdate window bounds). */
export function isoDateDaysAgo(days: number, from = new Date()): string {
  return toIsoDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() - days));
}

/** Local-date ISO string (yyyy-mm-dd). NOT toISOString() — that would shift days across timezones. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
