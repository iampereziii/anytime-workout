"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

/**
 * The "today status" card (Flow 7): last-workout recency, detraining flag,
 * and the EXACT remaining list — all computed server-side via lib/facts,
 * rendered verbatim here (business rules 4, 6, 7).
 */

export interface ProgramToday {
  date: string;
  day_number: number;
  label: string | null;
  day_notes: string | null;
  remaining: {
    planned_exercise_id: string;
    exercise_name: string;
    sets_done: number;
    sets_remaining: number;
    target_sets: number;
    target_reps: number | null;
    target_weight: number | null;
  }[];
  planned: { planned_exercise_id: string }[];
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

export function TodayStatus() {
  const [today, setToday] = useState<ProgramToday | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ProgramToday>("/api/program/today")
      .then(setToday)
      .catch(() => setError("Couldn't load today's status — offline?"));
  }, []);

  if (error) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-500 dark:bg-zinc-900">{error}</p>;
  if (!today) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-400 dark:bg-zinc-900">Loading today…</p>;

  const recency =
    today.days_since_last_workout === null
      ? "No workouts logged yet — log one to start your history"
      : today.days_since_last_workout === 0
        ? "Last workout: today"
        : `Last workout: ${today.days_since_last_workout} day${today.days_since_last_workout === 1 ? "" : "s"} ago`;

  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          Day {today.day_number}
          {today.label ? ` — ${today.label}` : ""}
        </h2>
        <Link href="/log" className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Log →
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-500">{recency}</p>
      {today.detraining && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400">
          14+ day gap — detraining mode: ease back in, no PR chasing.
        </p>
      )}
      {today.planned.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{today.day_notes ?? "No planned lifts today."}</p>
      ) : today.remaining.length === 0 ? (
        <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Today’s plan is complete ✓</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {today.remaining.map((r) => (
            <li
              key={r.planned_exercise_id}
              className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs dark:bg-zinc-800"
            >
              {r.exercise_name} · {r.sets_remaining} set{r.sets_remaining === 1 ? "" : "s"} left
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
