/**
 * Date helpers with LOCAL-day semantics — sessions and program days are
 * anchored to the user's local calendar day, never UTC.
 *
 * "Local" for CLIENT code means the device's zone (correct by construction).
 * "Local" for SERVER code means the server clock, which is UTC on Vercel — so
 * server-side "today" must instead be derived from the app's pinned home zone
 * (APP_TIMEZONE) via `appToday`/`appTodayIso` below. See feature-brief:
 * timezone-correct-today.
 */

/**
 * The app's home timezone (IANA), the single source of the owner's calendar day
 * on the server. Fail-fast (feature brief Risk #3): if unset we refuse to derive
 * "today" rather than silently falling back to the server clock (UTC on Vercel) —
 * that silent fallback is the exact wrong-day bug this feature exists to prevent.
 */
export function appTimeZone(): string {
  const tz = process.env.APP_TIMEZONE;
  if (!tz) {
    throw new Error(
      "APP_TIMEZONE is not set — refusing to derive the app's calendar day from the " +
        "server clock (UTC on Vercel). Set APP_TIMEZONE to the owner's IANA zone " +
        "(e.g. Asia/Manila) in .env.local and in the Vercel project settings.",
    );
  }
  return tz;
}

/** App-tz calendar year/month/day for an instant, via Intl (no dependency, DST-correct). */
function appTzYmd(instant: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: value("year"), m: value("month"), d: value("day") };
}

/**
 * The owner's calendar "today" as a Date at SERVER-local midnight carrying the
 * app-tz year/month/day. This is the shape lib/facts and `dayNumberFor` expect:
 * they read .getFullYear()/.getMonth()/.getDate()/.getDay() (server-local), so
 * pinning those fields to the app-tz date makes every downstream day computation
 * agree with the owner's calendar regardless of the server's own zone.
 */
export function appToday(now: Date = new Date(), tz: string = appTimeZone()): Date {
  const { y, m, d } = appTzYmd(now, tz);
  return new Date(y, m - 1, d);
}

/** The owner's calendar "today" as yyyy-mm-dd in the app timezone. */
export function appTodayIso(now: Date = new Date(), tz: string = appTimeZone()): string {
  const { y, m, d } = appTzYmd(now, tz);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * An instant as "yyyy-mm-dd HH:mm" on the owner's clock (workout-timing-sleep-state
 * brief) — the rendering for the facts block's `Now:` and `Last workout:` lines.
 * 24-hour clock, app timezone, minute precision.
 */
export function appClockTime(instant: Date = new Date(), tz: string = appTimeZone()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${appTodayIso(instant, tz)} ${value("hour")}:${value("minute")}`;
}

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

/**
 * Is a yyyy-mm-dd `date` within the inclusive backdate window [today − days, today]?
 * Pure day math (ISO dates compare lexicographically) — the server-side guard for
 * POST /api/log (feature brief AC #3), mirroring the log page's client-side window.
 */
export function isWithinBackdateWindow(date: string, today: Date, days = 7): boolean {
  return date >= isoDateDaysAgo(days, today) && date <= toIsoDate(today);
}

/** Local-date ISO string (yyyy-mm-dd). NOT toISOString() — that would shift days across timezones. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
