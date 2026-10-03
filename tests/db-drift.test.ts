import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeExerciseName } from "@/lib/exercises/normalize";
import { MUSCLE_GROUP_VOCABULARY } from "@/lib/muscle-groups";

/**
 * ADR-0012 drift guards: migration 0008 re-implements app rules in SQL for the
 * chat logging door. These tests fail the moment the TS and SQL copies diverge.
 * (The SQL normalizer itself is exercised against the same cases by
 * supabase/verify/0008_checks.sql — run after applying the migration.)
 */

const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

type NameCase = { input: string; expected: string };
const cases: NameCase[] = JSON.parse(read("tests/fixtures/exercise-name-cases.json"));

function between(text: string, start: string, end: string): string {
  const s = text.indexOf(start);
  const e = text.indexOf(end);
  if (s < 0 || e < 0 || e < s) throw new Error(`markers ${start} / ${end} not found`);
  return text.slice(s + start.length, e);
}

describe("migration 0008 ↔ TypeScript drift", () => {
  it("muscle_group_vocabulary() equals MUSCLE_GROUP_VOCABULARY (content and order)", () => {
    const block = between(read("supabase/migrations/0008_log_workout_fn.sql"), "-- vocab:start", "-- vocab:end");
    const sqlVocab = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(sqlVocab).toEqual([...MUSCLE_GROUP_VOCABULARY]);
  });

  it("shared name cases pass the TypeScript normalizer", () => {
    for (const c of cases) {
      expect(normalizeExerciseName(c.input), c.input).toBe(c.expected);
    }
  });

  it("the SQL verify script checks exactly the shared name cases", () => {
    const block = between(read("supabase/verify/0008_checks.sql"), "-- cases:start", "-- cases:end");
    const json = block.slice(block.indexOf("'") + 1, block.lastIndexOf("'"));
    expect(JSON.parse(json)).toEqual(cases);
  });
});
