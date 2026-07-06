import { describe, expect, it } from "vitest";
import {
  ChatRequestSchema,
  ExerciseCreateSchema,
  LogRequestSchema,
  ParseRequestSchema,
} from "@/lib/validators";

describe("LogRequestSchema", () => {
  const validSet = {
    exercise_id: "11111111-1111-4111-8111-111111111111",
    set_number: 1,
    reps: 12,
    weight: 32.5,
  };

  it("accepts a confirmed session payload and defaults part/notes", () => {
    const parsed = LogRequestSchema.parse({ date: "2026-07-05", sets: [validSet] });
    expect(parsed.part).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it("rejects an empty sets array — a session without sets is a junk write", () => {
    expect(LogRequestSchema.safeParse({ date: "2026-07-05", sets: [] }).success).toBe(false);
  });

  it("rejects a non-uuid exercise_id", () => {
    expect(
      LogRequestSchema.safeParse({ date: "2026-07-05", sets: [{ ...validSet, exercise_id: "push-up" }] }).success,
    ).toBe(false);
  });

  it("rejects a malformed date", () => {
    expect(LogRequestSchema.safeParse({ date: "07/05/2026", sets: [validSet] }).success).toBe(false);
  });

  it("accepts am/pm split parts (Flow 7)", () => {
    expect(LogRequestSchema.parse({ date: "2026-07-05", part: "am", sets: [validSet] }).part).toBe("am");
  });
});

describe("ExerciseCreateSchema", () => {
  it("defaults aliases/is_bodyweight/unit/muscle_groups", () => {
    const parsed = ExerciseCreateSchema.parse({ name: "Face Pull" });
    expect(parsed).toEqual({ name: "Face Pull", aliases: [], is_bodyweight: false, unit: "reps", muscle_groups: [] });
  });

  it("trims and rejects an empty name", () => {
    expect(ExerciseCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("accepts valid two-level muscle-group tags (parent + sub-group mix)", () => {
    const parsed = ExerciseCreateSchema.parse({
      name: "Diamond Push-up",
      muscle_groups: ["triceps", "chest_mid", "shoulders_front"],
    });
    expect(parsed.muscle_groups).toEqual(["triceps", "chest_mid", "shoulders_front"]);
  });

  it("rejects a free-text muscle group outside the fixed vocabulary (Risk #3 enforcement)", () => {
    expect(ExerciseCreateSchema.safeParse({ name: "Face Pull", muscle_groups: ["rear-delts"] }).success).toBe(false);
  });

  it("allows empty muscle_groups (cardio/mobility)", () => {
    expect(ExerciseCreateSchema.parse({ name: "Jog", muscle_groups: [] }).muscle_groups).toEqual([]);
  });
});

describe("ChatRequestSchema", () => {
  it("caps ephemeral history at 12 turns", () => {
    const history = Array.from({ length: 13 }, () => ({ role: "user" as const, content: "hi" }));
    expect(ChatRequestSchema.safeParse({ question: "what's left?", history }).success).toBe(false);
  });

  it("rejects an empty question", () => {
    expect(ChatRequestSchema.safeParse({ question: "  " }).success).toBe(false);
  });
});

describe("ParseRequestSchema", () => {
  it("rejects empty free text", () => {
    expect(ParseRequestSchema.safeParse({ text: "" }).success).toBe(false);
  });
});
