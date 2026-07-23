"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { isoDateDaysAgo, toIsoDate } from "@/lib/dates";
import { cacheExercises, enqueueLogWrite, flushQueue, getCachedExercises, getQueue } from "@/lib/offline";
import type { LogRequest } from "@/lib/validators";
import { Button } from "@/components/ui/button";
import { ExerciseCombobox } from "@/components/log/ExerciseCombobox";
import { formatEntrySummary, unitLabel } from "@/components/log/format";
import { FreeTextLog } from "@/components/log/FreeTextLog";
import type { CreateOpts } from "@/components/log/CreateFields";
import type { PendingEntry } from "@/components/log/types";
import { cn } from "@/lib/utils";
import type { Exercise, SessionPart } from "@/types/db";

/**
 * The log page — the daily-use core. Two doors, ONE dedup brain (rule 2):
 *  - Pick: creatable combobox (ADR-0003 primary path), works offline.
 *  - Free text: /api/parse proposals through the same confirm flow.
 * Both land on the shared pending list; /api/log fires only on the explicit
 * confirm (rules 1, 5). Offline, confirmed saves queue and sync on reconnect
 * (rule 10).
 */

type Door = "pick" | "text";

interface QuickEntry {
  exercise: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">;
  sets: number;
  reps: number;
  weight: number | null;
}

export default function LogPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [online, setOnline] = useState(true);
  const [door, setDoor] = useState<Door>("pick");
  const [part, setPart] = useState<SessionPart>(null);
  // Backdate window (feature brief: change-log-date): today back to today − 7.
  const [logDate, setLogDate] = useState(() => toIsoDate(new Date()));
  const [quick, setQuick] = useState<QuickEntry | null>(null);
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [queued, setQueued] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string; prs?: string[] } | null>(null);

  const syncQueue = useCallback(async () => {
    const { synced, remaining } = await flushQueue(async (payload) => {
      try {
        await apiPost("/api/log", payload);
        return true;
      } catch {
        return false; // stays queued; flushQueue stops and retries on next reconnect
      }
    });
    setQueued(remaining);
    if (synced > 0) setNotice({ kind: "ok", text: `Synced ${synced} queued workout${synced === 1 ? "" : "s"} ✓` });
  }, []);

  useEffect(() => {
    // Initial state lands via async callbacks (queue length via syncQueue below).
    queueMicrotask(() => {
      setOnline(navigator.onLine);
      void syncQueue();
    });

    apiGet<{ exercises: Exercise[] }>("/api/exercises")
      .then(({ exercises }) => {
        setExercises(exercises);
        cacheExercises(exercises);
      })
      .catch(() => {
        const cached = getCachedExercises();
        if (cached) setExercises(cached);
        else setNotice({ kind: "warn", text: "No exercise list available — connect once to seed the cache." });
      });

    const onOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncQueue]);

  /** Create a canonical exercise — only reachable AFTER the did-you-mean confirm (rule 1). */
  async function createExercise(name: string, opts: CreateOpts): Promise<Exercise | null> {
    try {
      const { exercise } = await apiPost<{ exercise: Exercise }>("/api/exercises", { name, ...opts });
      const next = [...exercises, exercise].sort((a, b) => a.name.localeCompare(b.name));
      setExercises(next);
      cacheExercises(next);
      return exercise;
    } catch (e) {
      setNotice({
        kind: "error",
        text: e instanceof ApiError ? e.message : "Couldn't create the exercise — offline?",
      });
      return null;
    }
  }

  function addQuickToPending() {
    if (!quick) return;
    setPending((prev) => [
      ...prev,
      {
        key: `${quick.exercise.id}-${Date.now()}`,
        exercise: quick.exercise,
        reps: Array.from({ length: quick.sets }, () => quick.reps),
        // Quick-add stays uniform-weight (ADR-0011) — one value repeated per set.
        weight: Array.from({ length: quick.sets }, () => quick.weight),
      },
    ]);
    setQuick(null);
  }

  async function save() {
    if (pending.length === 0) return;
    const today = toIsoDate(new Date());
    // Belt-and-braces for the input's min/max: reject outside the 7-day window.
    if (logDate > today || logDate < isoDateDaysAgo(7)) {
      setNotice({ kind: "error", text: "Log date must be within the last 7 days." });
      return;
    }
    setSaving(true);
    setNotice(null);
    const payload: LogRequest = {
      date: logDate,
      part,
      notes: null,
      sets: pending.flatMap((entry) =>
        entry.reps.map((r, i) => ({
          exercise_id: entry.exercise.id,
          set_number: i + 1,
          reps: r,
          weight: entry.weight[i] ?? null,
        })),
      ),
    };
    try {
      const { new_prs } = await apiPost<{
        session_id: string;
        set_count: number;
        new_prs: {
          exercise_name: string;
          reps: number;
          weight: number | null;
          unit: "reps" | "seconds" | "minutes";
          is_bodyweight: boolean;
          previous: { reps: number; weight: number | null };
        }[];
      }>("/api/log", payload);
      setPending([]);
      if (new_prs.length > 0) {
        // Computed server-side in lib/facts — the UI only formats (rule 4).
        const prs = new_prs.map((pr) => {
          const suffix = pr.unit === "reps" ? "" : pr.unit === "seconds" ? "s" : "min";
          const load = (w: number | null) => (w != null ? ` @ ${pr.is_bodyweight ? "BW +" : ""}${w} lbs` : "");
          return `${pr.exercise_name}: ${pr.reps}${suffix}${load(pr.weight)} (prev ${pr.previous.reps}${suffix}${load(pr.previous.weight)})`;
        });
        setNotice({ kind: "ok", text: `New PR${new_prs.length > 1 ? "s" : ""}! 🎉`, prs });
      } else {
        setNotice({ kind: "ok", text: "Workout saved ✓" });
      }
    } catch {
      enqueueLogWrite(payload);
      setQueued(getQueue().length);
      setPending([]);
      setNotice({ kind: "warn", text: "Offline — saved to the queue, will sync when you're back." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Log workout</h1>
        <Link href="/" className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          ← Chat
        </Link>
      </header>

      {!online && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          Offline — picker logging still works; saves will queue.
        </p>
      )}
      {queued > 0 && (
        <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {queued} workout{queued === 1 ? "" : "s"} queued for sync.
        </p>
      )}
      {notice && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            notice.kind === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            notice.kind === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            notice.kind === "error" && "bg-red-500/10 text-red-600 dark:text-red-400",
            notice.prs && "border border-emerald-500/40 font-medium",
          )}
        >
          {notice.text}
          {notice.prs && (
            <ul className="mt-1 list-inside list-disc font-normal">
              {notice.prs.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Session:</span>
        {([null, "am", "pm"] as SessionPart[]).map((p) => (
          <button
            key={String(p)}
            onClick={() => setPart(p)}
            className={cn(
              "rounded-full px-3 py-1",
              part === p ? "bg-emerald-600 text-white" : "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            {p === null ? "Single" : p.toUpperCase()}
          </button>
        ))}
        <span className="ml-2 text-zinc-500">Date:</span>
        <input
          type="date"
          value={logDate}
          min={isoDateDaysAgo(7)}
          max={toIsoDate(new Date())}
          onChange={(e) => setLogDate(e.target.value)}
          className={cn(
            "rounded-lg border px-2 py-1",
            logDate === toIsoDate(new Date())
              ? "border-zinc-300 dark:border-zinc-700"
              : "border-amber-500 text-amber-700 dark:text-amber-400",
          )}
        />
      </div>

      <div className="flex gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
        {(["pick", "text"] as Door[]).map((d) => (
          <button
            key={d}
            onClick={() => setDoor(d)}
            className={cn(
              "flex-1 rounded-lg py-1.5 text-sm font-medium",
              door === d && "bg-white shadow dark:bg-zinc-900",
            )}
          >
            {d === "pick" ? "Pick exercise" : "Free text"}
          </button>
        ))}
      </div>

      {door === "pick" ? (
        <ExerciseCombobox
          exercises={exercises}
          online={online}
          onSelect={(exercise) => setQuick({ exercise, sets: 3, reps: 10, weight: null })}
          onCreate={createExercise}
        />
      ) : (
        <FreeTextLog
          exercises={exercises}
          online={online}
          onAdd={(entries) => setPending((prev) => [...prev, ...entries])}
          onCreate={createExercise}
        />
      )}

      {quick && (
        <div className="rounded-xl border border-emerald-600/40 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="font-medium">{quick.exercise.name}</span>
            <button className="text-sm text-zinc-500" onClick={() => setQuick(null)}>
              cancel
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { label: "Sets", value: quick.sets, min: 1, set: (v: number) => setQuick({ ...quick, sets: v }) },
                {
                  label: unitLabel[quick.exercise.unit],
                  value: quick.reps,
                  min: 1,
                  set: (v: number) => setQuick({ ...quick, reps: v }),
                },
                {
                  label: quick.exercise.is_bodyweight ? "+lbs" : "lbs",
                  value: quick.weight ?? 0,
                  min: 0,
                  set: (v: number) => setQuick({ ...quick, weight: v === 0 ? null : v }),
                },
              ] as const
            ).map((f) => (
              <label key={f.label} className="flex flex-col gap-1 text-xs text-zinc-500">
                {f.label}
                <input
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  step={f.label.includes("lbs") ? 2.5 : 1}
                  value={f.value}
                  onChange={(e) => f.set(Number(e.target.value))}
                  className="rounded-lg border border-zinc-300 bg-transparent px-2 py-2 text-base dark:border-zinc-700"
                />
              </label>
            ))}
          </div>
          <Button className="mt-3 w-full" onClick={addQuickToPending}>
            Add {quick.sets} × {quick.reps} {unitLabel[quick.exercise.unit]}
            {quick.weight ? ` @ ${quick.exercise.is_bodyweight ? "BW +" : ""}${quick.weight} lbs` : ""}
          </Button>
        </div>
      )}

      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-500">Pending — not saved yet</h2>
          {pending.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center justify-between rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <div>
                <span className="font-medium">{entry.exercise.name}</span>{" "}
                <span className="text-sm text-zinc-500">
                  {formatEntrySummary(entry.reps, entry.weight, entry.exercise.unit, entry.exercise.is_bodyweight)}
                </span>
              </div>
              <button
                className="text-sm text-red-500"
                onClick={() => setPending((prev) => prev.filter((p) => p.key !== entry.key))}
              >
                remove
              </button>
            </div>
          ))}
          <Button onClick={() => void save()} disabled={saving} className="mt-1">
            {saving
              ? "Saving…"
              : `Confirm & save ${pending.length} exercise${pending.length === 1 ? "" : "s"}${
                  logDate === toIsoDate(new Date()) ? "" : ` — for ${logDate}`
                }`}
          </Button>
        </section>
      )}
    </main>
  );
}
