/**
 * Offline support (challenge #1 / business rule 10 — gym dead-zones are the
 * normal case, so /log must keep working with no signal):
 *  - Cache the canonical exercise list client-side (combobox + offline search).
 *  - Queue log writes when offline; replay to /api/log on reconnect.
 *    Append-only, so no conflict resolution — each queued write keeps its
 *    original local `date`.
 *
 * Storage is injectable so the logic is unit-testable in Node (a Map-backed
 * fake in tests); at runtime it defaults to window.localStorage.
 */

import type { LogRequest } from "@/lib/validators";
import type { Exercise } from "@/types/db";

const EXERCISES_KEY = "atw:exercises:v1";
const QUEUE_KEY = "atw:log-queue:v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(s?: StorageLike): StorageLike | null {
  if (s) return s;
  return typeof window === "undefined" ? null : window.localStorage;
}

function readJson<T>(key: string, s: StorageLike): T | null {
  try {
    const raw = s.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// ---------- exercise-list cache ----------

export function cacheExercises(list: Exercise[], s?: StorageLike): void {
  const storage = resolveStorage(s);
  if (!storage) return;
  storage.setItem(EXERCISES_KEY, JSON.stringify(list));
}

export function getCachedExercises(s?: StorageLike): Exercise[] | null {
  const storage = resolveStorage(s);
  if (!storage) return null;
  return readJson<Exercise[]>(EXERCISES_KEY, storage);
}

// ---------- offline write queue ----------

export interface QueuedWrite {
  id: string;
  payload: LogRequest;
  queued_at: string; // ISO timestamp
}

function writeQueue(queue: QueuedWrite[], s: StorageLike): void {
  s.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue(s?: StorageLike): QueuedWrite[] {
  const storage = resolveStorage(s);
  if (!storage) return [];
  return readJson<QueuedWrite[]>(QUEUE_KEY, storage) ?? [];
}

export function enqueueLogWrite(payload: LogRequest, s?: StorageLike): QueuedWrite | null {
  const storage = resolveStorage(s);
  if (!storage) return null;
  const item: QueuedWrite = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    payload,
    queued_at: new Date().toISOString(),
  };
  writeQueue([...getQueue(storage), item], storage);
  return item;
}

/**
 * Replay queued writes in order via `post` (which resolves true on success).
 * Stops at the first failure to preserve order and avoid hammering a dead
 * connection; successfully synced items are removed as they land.
 */
export async function flushQueue(
  post: (payload: LogRequest) => Promise<boolean>,
  s?: StorageLike,
): Promise<{ synced: number; remaining: number }> {
  const storage = resolveStorage(s);
  if (!storage) return { synced: 0, remaining: 0 };

  let queue = getQueue(storage);
  let synced = 0;
  for (const item of [...queue]) {
    let okResult = false;
    try {
      okResult = await post(item.payload);
    } catch {
      okResult = false;
    }
    if (!okResult) break;
    queue = queue.filter((q) => q.id !== item.id);
    writeQueue(queue, storage);
    synced++;
  }
  return { synced, remaining: queue.length };
}
