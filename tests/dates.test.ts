import { afterEach, describe, expect, it } from "vitest";
import {
  appTimeZone,
  appToday,
  appTodayIso,
  dayNumberFor,
  isoDateDaysAgo,
  isWithinBackdateWindow,
  toIsoDate,
} from "@/lib/dates";

describe("dayNumberFor (program day convention: 1 = Monday … 7 = Sunday)", () => {
  it("maps the seed baseline anchor 2026-06-29 (Monday) to day 1", () => {
    expect(dayNumberFor(new Date(2026, 5, 29))).toBe(1);
  });

  it("maps Sunday to day 7 (Rest)", () => {
    expect(dayNumberFor(new Date(2026, 6, 5))).toBe(7);
  });

  it("maps Friday to day 5 (Power Day)", () => {
    expect(dayNumberFor(new Date(2026, 6, 3))).toBe(5);
  });
});

describe("toIsoDate (LOCAL day, zero-padded)", () => {
  it("pads month and day", () => {
    expect(toIsoDate(new Date(2026, 6, 5))).toBe("2026-07-05");
  });

  it("uses the local calendar day even late at night (no UTC shift)", () => {
    expect(toIsoDate(new Date(2026, 6, 5, 23, 55))).toBe("2026-07-05");
  });
});

describe("isoDateDaysAgo (backdate window bound — change-log-date brief)", () => {
  it("computes the 7-day window floor", () => {
    expect(isoDateDaysAgo(7, new Date(2026, 6, 6))).toBe("2026-06-29");
  });

  it("crosses month boundaries correctly", () => {
    expect(isoDateDaysAgo(7, new Date(2026, 7, 3))).toBe("2026-07-27");
  });
});

describe("app-tz today (timezone-correct-today brief)", () => {
  // NOTE ON DST: the confirmed zone Asia/Manila observes NO daylight saving, so a
  // DST-transition test is DELIBERATELY omitted (feature brief Gaps). If APP_TIMEZONE
  // is ever changed to a DST-observing zone, add a spring-forward / fall-back case.

  const MANILA = "Asia/Manila"; // UTC+8, fixed

  it("resolves the proven failing case: UTC lags a day behind the owner's evening", () => {
    // 23:03Z on Jul 5 is 07:03 on Jul 6 in Manila — the owner's calendar day is Jul 6,
    // while the server clock (UTC) still reads Jul 5. This is the exact prod incident.
    const instant = new Date("2026-07-05T23:03:00Z");
    expect(appTodayIso(instant, MANILA)).toBe("2026-07-06");
    // …and the derived program day is Monday (Day 1), not Sunday (Day 7).
    expect(dayNumberFor(appToday(instant, MANILA))).toBe(1);
    expect(toIsoDate(appToday(instant, MANILA))).toBe("2026-07-06");
  });

  it("contrasts with the UTC-derived day the bug produced", () => {
    const instant = new Date("2026-07-05T23:03:00Z");
    // Same instant, server-clock (UTC) derivation → the wrong day the fix eliminates.
    expect(appTodayIso(instant, "UTC")).toBe("2026-07-05");
    expect(dayNumberFor(appToday(instant, "UTC"))).toBe(7); // Sunday / Rest
  });

  it("crosses a month boundary (Manila is ahead of UTC)", () => {
    // 18:00Z Jul 31 = 02:00 Aug 1 in Manila.
    const instant = new Date("2026-07-31T18:00:00Z");
    expect(appTodayIso(instant, MANILA)).toBe("2026-08-01");
    expect(toIsoDate(appToday(instant, MANILA))).toBe("2026-08-01");
  });

  it("crosses a year boundary", () => {
    // 20:00Z Dec 31 = 04:00 Jan 1 in Manila.
    const instant = new Date("2026-12-31T20:00:00Z");
    expect(appTodayIso(instant, MANILA)).toBe("2027-01-01");
  });
});

describe("isWithinBackdateWindow (server-side /api/log guard — AC #3)", () => {
  const today = new Date(2026, 6, 6); // 2026-07-06

  it("accepts today itself (inclusive upper bound)", () => {
    expect(isWithinBackdateWindow("2026-07-06", today)).toBe(true);
  });

  it("accepts the window floor, today − 7 (inclusive lower bound)", () => {
    expect(isWithinBackdateWindow("2026-06-29", today)).toBe(true);
  });

  it("rejects a future date (the server's-viewpoint 'future' row that caused the incident)", () => {
    expect(isWithinBackdateWindow("2026-07-07", today)).toBe(false);
  });

  it("rejects a date older than 7 days", () => {
    expect(isWithinBackdateWindow("2026-06-28", today)).toBe(false);
  });
});

describe("appTimeZone (fail-fast on missing env — Risk #3)", () => {
  const original = process.env.APP_TIMEZONE;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = original;
  });

  it("throws when APP_TIMEZONE is unset (never silently falls back to UTC)", () => {
    delete process.env.APP_TIMEZONE;
    expect(() => appTimeZone()).toThrow(/APP_TIMEZONE is not set/);
  });

  it("returns the configured zone when set", () => {
    process.env.APP_TIMEZONE = "Asia/Manila";
    expect(appTimeZone()).toBe("Asia/Manila");
  });
});
