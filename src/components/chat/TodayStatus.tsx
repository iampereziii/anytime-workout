"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api-client";

/**
 * The "today status" card (Flow 7): last-workout recency, detraining flag,
 * and the EXACT remaining list — all computed server-side via lib/facts,
 * rendered verbatim here (business rules 4, 6, 7).
 *
 * Header is recommendation-first (feature brief: ai-today-recommendation): the
 * AI-composed suggestion leads, the calendar plan demotes to secondary text.
 * Deterministic content (recency, pills, detraining) renders immediately off
 * /api/program/today; the recommendation fills in async off /api/recommendation
 * and never blocks. If it never arrives (loading, fallback), the calendar-day
 * header shows unchanged — never a broken header (AC #5/#6).
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

interface SuggestedLift {
  exercise_name: string;
  target_sets: number;
  target_reps: number | null;
  target_weight: number | null;
  unit: string;
}

interface Recommendation {
  suggested_focus: string;
  headline: string;
  reason: string;
  calendar_day_number: number;
  calendar_day_label: string | null;
  diverges: boolean;
  suggested_lifts: SuggestedLift[] | null;
}

function suggestedLiftLabel(l: SuggestedLift): string {
  const reps = l.target_reps == null ? "max" : `${l.target_reps}`;
  const weight = l.target_weight != null ? ` @ ${l.target_weight}` : "";
  return `${l.exercise_name} · ${l.target_sets}×${reps}${weight}`;
}

export function TodayStatus() {
  const [today, setToday] = useState<ProgramToday | null>(null);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ProgramToday>("/api/program/today")
      .then(setToday)
      .catch(() => setError("Couldn't load today's status — offline?"));
    // Recommendation is best-effort and non-blocking: any failure just leaves
    // the calendar-day header in place. Never surfaces an error to the card.
    apiGet<{ recommendation: Recommendation | null }>("/api/recommendation")
      .then((d) => setRec(d.recommendation))
      .catch(() => {});
  }, []);

  if (error) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-500 dark:bg-zinc-900">{error}</p>;
  if (!today) return <p className="rounded-xl bg-zinc-100 p-3 text-sm text-zinc-400 dark:bg-zinc-900">Loading today…</p>;

  // Belt-and-suspenders with the API clamp (AC #6): a negative recency is data
  // drift, never a display case — floor it at 0 so the card can't show "-1 days ago".
  const daysSince =
    today.days_since_last_workout === null ? null : Math.max(0, today.days_since_last_workout);
  const recency =
    daysSince === null
      ? "No workouts logged yet — log one to start your history"
      : daysSince === 0
        ? "Last workout: today"
        : `Last workout: ${daysSince} day${daysSince === 1 ? "" : "s"} ago`;

  const calendarLine = `Day ${today.day_number}${today.label ? ` — ${today.label}` : ""}`;
  // When the suggestion diverges, the card targets the suggested day's lifts.
  const showSuggestedLifts = rec?.diverges && rec.suggested_lifts != null;

  return (
    <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2">
        {rec ? (
          <div className="min-w-0">
            <h2 className="font-semibold">{rec.headline}</h2>
            <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{rec.reason}</p>
          </div>
        ) : (
          <h2 className="font-semibold">{calendarLine}</h2>
        )}
        <Link href="/log" className="shrink-0 text-sm font-medium text-emerald-600 dark:text-emerald-400">
          Log →
        </Link>
      </div>
      {/* Plan reference is never lost — demoted to secondary text when the AI leads. */}
      {rec && <p className="mt-1 text-xs text-zinc-400">Plan says: {calendarLine}</p>}
      <p className="mt-1 text-sm text-zinc-500">{recency}</p>
      {today.detraining && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400">
          14+ day gap — detraining mode: ease back in, no PR chasing.
        </p>
      )}
      {showSuggestedLifts ? (
        rec!.suggested_lifts!.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Suggested: take it as a rest/recovery day.</p>
        ) : (
          <>
            <p className="mt-2 text-xs font-medium text-zinc-500">Suggested lifts</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {rec!.suggested_lifts!.map((l, i) => (
                <li
                  key={`${l.exercise_name}-${i}`}
                  className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-400"
                >
                  {suggestedLiftLabel(l)}
                </li>
              ))}
            </ul>
          </>
        )
      ) : today.planned.length === 0 ? (
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
