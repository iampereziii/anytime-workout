"use client";

import { useState } from "react";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { didYouMean, type ExerciseMatch } from "@/lib/exercises/dedup";
import type { ParsedLog } from "@/lib/openai/schemas";
import { Button } from "@/components/ui/button";
import type { Exercise } from "@/types/db";
import type { PendingEntry } from "./types";

/**
 * The secondary log door (Flow 5): free text → /api/parse (Structured Outputs)
 * → per-entry name resolution through the SAME dedup brain as the combobox
 * (business rule 2) → user confirms → entries join the shared pending list.
 * Nothing here persists — /api/log only fires from the page-level confirm.
 *
 * High-confidence matches (≥0.5) are PRE-PROPOSED in the select, never
 * auto-applied — the user can always switch to another match or create new.
 */

interface ProposalRow {
  raw_name: string;
  reps: number[];
  weight: number | null;
  candidates: ExerciseMatch[];
  /** exercise id, or "__create__" for create-new. */
  chosen: string;
}

export function FreeTextLog({
  exercises,
  online,
  onAdd,
  onCreate,
}: {
  exercises: Exercise[];
  online: boolean;
  onAdd: (entries: PendingEntry[]) => void;
  onCreate: (name: string) => Promise<Exercise | null>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clarification, setClarification] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalRow[] | null>(null);

  async function parse() {
    setBusy(true);
    setError(null);
    setClarification(null);
    setProposals(null);
    try {
      const { parsed } = await apiPost<{ parsed: ParsedLog }>("/api/parse", { text });
      if (parsed.clarification_needed || parsed.entries.length === 0) {
        setClarification(parsed.clarification_question ?? "Could you add sets and reps?");
        return;
      }
      const rows: ProposalRow[] = [];
      for (const entry of parsed.entries) {
        let candidates: ExerciseMatch[] = [];
        try {
          const data = await apiGet<{ results: ExerciseMatch[] }>(
            `/api/exercises?q=${encodeURIComponent(entry.raw_name)}`,
          );
          candidates = data.results;
        } catch {
          candidates = [];
        }
        const strong = didYouMean(candidates);
        rows.push({
          raw_name: entry.raw_name,
          reps: Array.isArray(entry.reps) ? entry.reps : Array.from({ length: entry.sets }, () => entry.reps as number),
          weight: entry.weight_lbs,
          candidates,
          chosen: strong.length > 0 ? strong[0].id : "__create__",
        });
      }
      setProposals(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't parse that — are you online?");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!proposals) return;
    setBusy(true);
    setError(null);
    try {
      const byId = new Map(exercises.map((e) => [e.id, e]));
      const entries: PendingEntry[] = [];
      for (const row of proposals) {
        let exercise: Pick<Exercise, "id" | "name" | "unit" | "is_bodyweight">;
        if (row.chosen === "__create__") {
          const created = await onCreate(row.raw_name);
          if (!created) return; // creation failed/cancelled — keep proposals for retry
          exercise = created;
        } else {
          const match = row.candidates.find((c) => c.id === row.chosen);
          exercise =
            byId.get(row.chosen) ??
            ({ id: row.chosen, name: match?.name ?? row.raw_name, unit: "reps", is_bodyweight: false } as Exercise);
        }
        entries.push({
          key: `${exercise.id}-${Date.now()}-${entries.length}`,
          exercise,
          reps: row.reps,
          weight: row.weight,
        });
      }
      onAdd(entries);
      setText("");
      setProposals(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder='e.g. "did 3x12 elevated push-ups and 3x10 dips +10"'
        className="w-full rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700"
      />
      {clarification && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {clarification}
        </p>
      )}
      {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!online && (
        <p className="text-sm text-zinc-500">Free-text logging needs a connection — use the picker offline.</p>
      )}
      {!proposals && (
        <Button onClick={() => void parse()} disabled={busy || !text.trim() || !online}>
          {busy ? "Parsing…" : "Parse it"}
        </Button>
      )}

      {proposals && (
        <div className="flex flex-col gap-3">
          {proposals.map((row, i) => (
            <div key={i} className="rounded-xl border border-zinc-300 p-3 dark:border-zinc-700">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="font-medium">“{row.raw_name}”</span>
                <span className="text-sm text-zinc-500">
                  {row.reps.length} × {row.reps.join("/")}
                  {row.weight != null ? ` @ ${row.weight} lbs` : ""}
                </span>
              </div>
              <select
                value={row.chosen}
                onChange={(e) =>
                  setProposals((prev) =>
                    prev ? prev.map((r, j) => (j === i ? { ...r, chosen: e.target.value } : r)) : prev,
                  )
                }
                className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {row.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({Math.round(c.similarity * 100)}%{c.matched_alias ? ", alias" : ""})
                  </option>
                ))}
                <option value="__create__">➕ Create “{row.raw_name}” as new</option>
              </select>
            </div>
          ))}
          <div className="flex gap-2">
            <Button onClick={() => void confirm()} disabled={busy}>
              {busy ? "Adding…" : "Add to pending"}
            </Button>
            <Button variant="outline" onClick={() => setProposals(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
