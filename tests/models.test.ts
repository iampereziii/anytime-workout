import { describe, expect, it } from "vitest";
import { PARSE_MODEL, RECOMMENDATION_MODEL } from "@/lib/openai/models";
import { ParsedLogSchema } from "@/lib/openai/schemas";

describe("model pins are LAW (business rule 8 / challenge #3)", () => {
  it("chat is pinned to GPT-5.4 — changing this requires updating the spec's cost projection", () => {
    expect(RECOMMENDATION_MODEL).toBe("gpt-5.4");
  });

  it("parse is pinned to GPT-5.4-mini", () => {
    expect(PARSE_MODEL).toBe("gpt-5.4-mini");
  });
});

describe("ParsedLogSchema (rule 5 shapes)", () => {
  it("accepts the clarification shape — empty entries + one question", () => {
    const parsed = ParsedLogSchema.parse({
      entries: [],
      clarification_needed: true,
      clarification_question: "How many sets and reps?",
    });
    expect(parsed.entries).toHaveLength(0);
  });

  it("accepts per-set rep arrays ('12/12/11/10') and uniform reps alike", () => {
    const parsed = ParsedLogSchema.parse({
      entries: [
        { raw_name: "elevated", sets: 4, reps: [12, 12, 11, 10], weight_lbs: null },
        { raw_name: "dips", sets: 3, reps: 10, weight_lbs: 10 },
      ],
      clarification_needed: false,
      clarification_question: null,
    });
    expect(parsed.entries[0].reps).toEqual([12, 12, 11, 10]);
  });
});
