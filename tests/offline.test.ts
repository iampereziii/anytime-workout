import { describe, expect, it } from "vitest";
import {
  cacheExercises,
  enqueueLogWrite,
  flushQueue,
  getCachedExercises,
  getQueue,
  type StorageLike,
} from "@/lib/offline";
import type { LogRequest } from "@/lib/validators";
import type { Exercise } from "@/types/db";

/** Business rule 10 — offline logging degrades gracefully (queue + cache). */

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const payload = (date: string): LogRequest => ({
  date,
  part: null,
  notes: null,
  sets: [{ exercise_id: "11111111-1111-1111-1111-111111111111", set_number: 1, reps: 10, weight: null }],
});

describe("exercise-list cache", () => {
  it("round-trips the canonical list", () => {
    const s = fakeStorage();
    const list = [
      { id: "1", name: "Push-up", aliases: [], is_bodyweight: true, unit: "reps", muscle_groups: [], default_rest_seconds: null, default_cue: null, created_at: "" },
    ];
    cacheExercises(list as Exercise[], s);
    expect(getCachedExercises(s)).toEqual(list);
  });

  it("returns null when nothing is cached", () => {
    expect(getCachedExercises(fakeStorage())).toBeNull();
  });
});

describe("offline write queue (append-only, original date preserved)", () => {
  it("enqueues with the original local date intact", () => {
    const s = fakeStorage();
    enqueueLogWrite(payload("2026-07-04"), s);
    const queue = getQueue(s);
    expect(queue).toHaveLength(1);
    expect(queue[0].payload.date).toBe("2026-07-04");
  });

  it("flushQueue syncs in order and removes only what landed", async () => {
    const s = fakeStorage();
    enqueueLogWrite(payload("2026-07-01"), s);
    enqueueLogWrite(payload("2026-07-02"), s);
    const posted: string[] = [];
    const result = await flushQueue(async (p) => {
      posted.push(p.date);
      return true;
    }, s);
    expect(posted).toEqual(["2026-07-01", "2026-07-02"]);
    expect(result).toEqual({ synced: 2, remaining: 0 });
    expect(getQueue(s)).toHaveLength(0);
  });

  it("stops at the first failure and keeps the rest queued (retry on next reconnect)", async () => {
    const s = fakeStorage();
    enqueueLogWrite(payload("2026-07-01"), s);
    enqueueLogWrite(payload("2026-07-02"), s);
    let calls = 0;
    const result = await flushQueue(async () => ++calls === 1, s); // first succeeds, second fails
    expect(result).toEqual({ synced: 1, remaining: 1 });
    expect(getQueue(s)[0].payload.date).toBe("2026-07-02");
  });

  it("a throwing post counts as failure, never loses the write", async () => {
    const s = fakeStorage();
    enqueueLogWrite(payload("2026-07-03"), s);
    const result = await flushQueue(async () => {
      throw new Error("network down");
    }, s);
    expect(result).toEqual({ synced: 0, remaining: 1 });
  });
});
