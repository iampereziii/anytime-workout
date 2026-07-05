import { describe, expect, it } from "vitest";
import {
  DEDUP_THRESHOLD,
  didYouMean,
  searchOffline,
  trigramSimilarity,
  type ExerciseMatch,
  type SearchableExercise,
} from "@/lib/exercises/dedup";

/**
 * Business rules 1, 2, 12 — the dedup brain.
 * The server RPC (pg_trgm) is the online source of truth; these tests cover
 * the shared threshold logic and the offline mirror.
 */

const match = (id: string, name: string, similarity: number, matched_alias = false): ExerciseMatch => ({
  id,
  name,
  similarity,
  matched_alias,
});

describe("didYouMean (rule 1 — a list to choose from, never a verdict)", () => {
  it("keeps candidates at or above the spike-validated 0.5 threshold", () => {
    const results = [match("a", "Push-up", 0.74), match("b", "Pull-up", 0.5), match("c", "Plank", 0.32)];
    expect(didYouMean(results).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns an empty list (creation proceeds) when nothing is close", () => {
    expect(didYouMean([match("a", "Squat", 0.2)])).toEqual([]);
  });

  it("threshold is exactly the ADR-0003 value", () => {
    expect(DEDUP_THRESHOLD).toBe(0.5);
  });
});

describe("trigramSimilarity (offline mirror of pg_trgm)", () => {
  it("scores near-duplicates above the did-you-mean threshold (spike pair)", () => {
    expect(trigramSimilarity("elevated pushup", "elevated push-up")).toBeGreaterThanOrEqual(0.5);
    expect(trigramSimilarity("benchpress", "bench press")).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps variations apart — elevated vs regular push-up stays below 0.5 (spike ≈ 0.32)", () => {
    expect(trigramSimilarity("elevated push-up", "regular push-up")).toBeLessThan(0.5);
  });

  it("abbreviations are trigram-invisible (spike: RDL ≈ 0.048) — that's what aliases are for", () => {
    expect(trigramSimilarity("RDL", "Romanian Deadlift")).toBeLessThan(0.15);
  });
});

describe("searchOffline (rules 10 + 12 — offline combobox search)", () => {
  const list: SearchableExercise[] = [
    { id: "1", name: "Romanian Deadlift", aliases: ["RDL", "romanian dead lift"] },
    { id: "2", name: "Push-up", aliases: ["pushup"] },
    { id: "3", name: "Incline Push-up", aliases: ["elevated push-up"] },
  ];

  it("alias hit ranks first at similarity 1.0 — 'rdl' finds Romanian Deadlift", () => {
    const results = searchOffline(list, "rdl");
    expect(results[0]).toMatchObject({ id: "1", similarity: 1.0, matched_alias: true });
  });

  it("trigram match on name works offline", () => {
    const results = searchOffline(list, "push up");
    expect(results.map((r) => r.id)).toContain("2");
  });

  it("empty query returns nothing", () => {
    expect(searchOffline(list, "  ")).toEqual([]);
  });
});
