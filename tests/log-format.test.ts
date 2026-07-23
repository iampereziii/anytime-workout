import { describe, expect, it } from "vitest";
import {
  formatEntrySummary,
  formatProposalSummary,
  isUniformWeight,
  toPerSetWeights,
} from "@/components/log/format";

/** Per-set weight display + normalization (pyramid brief / ADR-0011). */

describe("toPerSetWeights", () => {
  it("fills a single value across all sets (uniform case)", () => {
    expect(toPerSetWeights(25, 3)).toEqual([25, 25, 25]);
  });

  it("fills null across all sets (plain bodyweight)", () => {
    expect(toPerSetWeights(null, 2)).toEqual([null, null]);
  });

  it("passes an aligned per-set array through untouched", () => {
    expect(toPerSetWeights([17.5, 20, 25], 3)).toEqual([17.5, 20, 25]);
  });

  it("pads a short array with its last value and trims a long one — misparse stays visible, never crashes", () => {
    expect(toPerSetWeights([20, 25], 3)).toEqual([20, 25, 25]);
    expect(toPerSetWeights([20, 25, 30, 35], 3)).toEqual([20, 25, 30]);
  });
});

describe("isUniformWeight", () => {
  it("treats one repeated value — or all-null — as uniform", () => {
    expect(isUniformWeight([25, 25, 25])).toBe(true);
    expect(isUniformWeight([null, null])).toBe(true);
  });

  it("detects varied loads", () => {
    expect(isUniformWeight([17.5, 20, 25])).toBe(false);
  });
});

describe("formatEntrySummary (pending list)", () => {
  it("uniform load renders the pre-pyramid string unchanged (AC #4)", () => {
    expect(formatEntrySummary([12, 10, 8], [25, 25, 25], "reps", false)).toBe("3 × 12/10/8 reps @ 25 lbs");
    expect(formatEntrySummary([10, 10], [10, 10], "reps", true)).toBe("2 × 10/10 reps @ BW +10 lbs");
    expect(formatEntrySummary([60, 60], [null, null], "seconds", true)).toBe("2 × 60/60 sec");
  });

  it("varied loads render per-set pairs (AC #2 display)", () => {
    expect(formatEntrySummary([12, 10, 8], [17.5, 20, 25], "reps", false)).toBe("12 @ 17.5 / 10 @ 20 / 8 @ 25 lbs");
  });

  it("bodyweight pyramid marks the loads as added lbs", () => {
    expect(formatEntrySummary([12, 10, 8], [10, 15, 20], "reps", true)).toBe("12 @ 10 / 10 @ 15 / 8 @ 20 lbs added");
  });
});

describe("formatProposalSummary (parse confirm row)", () => {
  it("uniform load keeps the compact pre-resolution string", () => {
    expect(formatProposalSummary([12, 12, 11], [25, 25, 25])).toBe("3 × 12/12/11 @ 25 lbs");
    expect(formatProposalSummary([10, 10], [null, null])).toBe("2 × 10/10");
  });

  it("varied loads render per-set pairs", () => {
    expect(formatProposalSummary([12, 10, 8], [17.5, 20, 25])).toBe("12 @ 17.5 / 10 @ 20 / 8 @ 25 lbs");
  });
});
