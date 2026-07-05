import { describe, expect, it } from "vitest";
import { dayNumberFor, isoDateDaysAgo, toIsoDate } from "@/lib/dates";

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
