"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

/**
 * The Today card (ADR-0007) — one AI-generated recommendation surface. The card
 * fetches `/api/recommendation` once: the deterministic base (recency, detraining)
 * always renders; the AI recommendation (focus + composed lifts + reason) leads when
 * present and never blocks. If the composition is unavailable (loading, fallback),
 * a neutral header + recency shows — never a broken header (AC #5/#6).
 *
 * "N sets left" re-derives against the day's PINNED recommendation (finding 4), so
 * it counts down as sets are logged and never jumps mid-workout.
 */

interface TodayBase {
  date: string;
  days_since_last_workout: number | null;
  detraining: boolean;
  last_workout_date: string | null;
}

interface RecommendationLift {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
  rest_seconds: number | null;
  cue: string | null;
  sets_done: number;
  sets_remaining: number;
}

interface Recommendation {
  focus: string;
  headline: string;
  reason: string;
  is_recovery: boolean;
  lifts: RecommendationLift[] | null;
  remaining_count: number;
}

interface TodayResponse {
  recommendation: Recommendation | null;
  today: TodayBase | null;
}

function liftLabel(l: RecommendationLift): string {
  const reps = l.target_reps == null ? "max" : `${l.target_reps}`;
  const weight = l.target_weight != null ? ` @ ${l.target_weight}` : "";
  return `${l.exercise_name} · ${l.target_sets}×${reps}${weight}`;
}

export function TodayStatus() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<TodayResponse>("/api/recommendation")
      .then(setData)
      .catch(() => setError("Couldn't load today's status — offline?"));
  }, []);

  if (error) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-500 dark:bg-zinc-900">{error}</p>;
  if (!data) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-400 dark:bg-zinc-900">Loading today…</p>;

  const { recommendation: rec, today } = data;

  // Belt-and-suspenders with the API clamp (AC #6): a negative recency is data
  // drift, never a display case — floor it at 0 so the card can't show "-1 days ago".
  const daysSince =
    today?.days_since_last_workout == null ? null : Math.max(0, today.days_since_last_workout);
  const recency =
    daysSince === null
      ? "No workouts logged yet — log one to start your history"
      : daysSince === 0
        ? "Last workout: today"
        : `Last workout: ${daysSince} day${daysSince === 1 ? "" : "s"} ago`;

  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2">
        {rec ? (
          <div className="min-w-0">
            <h2 className="font-semibold">{rec.headline}</h2>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{rec.reason}</p>
          </div>
        ) : (
          <h2 className="font-semibold">Today</h2>
        )}
        <Link href="/log" className="shrink-0 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Log →
        </Link>
      </div>

      <p className="mt-1 text-sm text-zinc-500">{recency}</p>

      {today?.detraining && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400">
          14+ day gap — detraining mode: ease back in, no PR chasing.
        </p>
      )}

      {rec?.is_recovery ? (
        <p className="mt-2 text-sm text-zinc-500">Recovery day — rest or active recovery (walk / mobility).</p>
      ) : rec?.lifts && rec.lifts.length > 0 ? (
        <>
          <p className="mt-2 text-xs font-medium text-zinc-500">
            {rec.focus}
            {rec.remaining_count > 0 ? ` · ${rec.remaining_count} sets left` : " · complete ✓"}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {rec.lifts.map((l, i) => (
              <li
                key={`${l.exercise_name}-${i}`}
                className={
                  l.sets_remaining === 0
                    ? "rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-400 line-through dark:bg-zinc-800"
                    : "rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-400"
                }
              >
                {liftLabel(l)}
                {l.sets_remaining > 0 ? ` — ${l.sets_remaining} left` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : (
        !rec && (
          <p className="mt-2 text-sm text-zinc-500">Open the app to get today’s recommendation.</p>
        )
      )}
    </section>
  );
}
