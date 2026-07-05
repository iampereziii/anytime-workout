"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { apiGet } from "@/lib/api-client";
import { didYouMean, searchOffline, type ExerciseMatch } from "@/lib/exercises/dedup";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "./ConfirmSheet";
import type { Exercise } from "@/types/db";

/**
 * The primary log door (ADR-0003): creatable combobox over the canonical list.
 * Online, candidates come from the search_exercises RPC; offline, from the
 * cached list via the client trigram mirror — so /log works in gym dead-zones.
 *
 * Create flow (business rule 1 — never silent, never blocked): "Create X"
 * first runs the ≥0.5 did-you-mean check; the user picks an existing match or
 * explicitly creates anyway.
 */
export function ExerciseCombobox({
  exercises,
  online,
  onSelect,
  onCreate,
}: {
  exercises: Exercise[];
  online: boolean;
  onSelect: (exercise: Exercise) => void;
  onCreate: (name: string) => Promise<Exercise | null>;
  }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExerciseMatch[]>([]);
  const [dedupFor, setDedupFor] = useState<{ name: string; candidates: ExerciseMatch[] } | null>(null);
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!q) {
        setResults([]);
        return;
      }
      if (online) {
        try {
          const data = await apiGet<{ results: ExerciseMatch[] }>(`/api/exercises?q=${encodeURIComponent(q)}`);
          setResults(data.results);
          return;
        } catch {
          // fall through to the offline mirror
        }
      }
      setResults(searchOffline(exercises, q));
    }, q ? 200 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, online, exercises]);

  function pick(id: string, name: string) {
    const detail =
      byId.get(id) ??
      ({ id, name, aliases: [], is_bodyweight: false, unit: "reps", created_at: "" } as Exercise);
    setQuery("");
    setResults([]);
    onSelect(detail);
  }

  async function create(name: string) {
    setCreating(true);
    try {
      const created = await onCreate(name);
      if (created) {
        setDedupFor(null);
        setQuery("");
        setResults([]);
        onSelect(created);
      }
    } finally {
      setCreating(false);
    }
  }

  /** "Create X" entry point — runs the did-you-mean check first (rule 1). */
  function requestCreate() {
    const name = query.trim();
    if (!name) return;
    const candidates = didYouMean(results);
    if (candidates.length > 0) {
      setDedupFor({ name, candidates });
    } else {
      void create(name);
    }
  }

  const q = query.trim();
  const exactMatch = results.some((r) => r.name.toLowerCase() === q.toLowerCase());
  const listed = q ? results : exercises.map((e) => ({ id: e.id, name: e.name, similarity: 0, matched_alias: false }));

  return (
    <div>
      <Command shouldFilter={false} className="rounded-xl border border-zinc-300 dark:border-zinc-700">
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search or type an exercise…"
          className="w-full rounded-t-xl border-b border-zinc-200 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-zinc-400 dark:border-zinc-800"
        />
        <Command.List className="max-h-56 overflow-y-auto p-1">
          {listed.map((r) => (
            <Command.Item
              key={r.id}
              value={r.id}
              onSelect={() => pick(r.id, r.name)}
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm",
                "data-[selected=true]:bg-emerald-600/10",
              )}
            >
              <span>{r.name}</span>
              {r.matched_alias && <span className="text-xs text-zinc-500">alias</span>}
            </Command.Item>
          ))}
          {q && !exactMatch && (
            <Command.Item
              value={`__create__${q}`}
              onSelect={requestCreate}
              disabled={!online || creating}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-emerald-600 data-[selected=true]:bg-emerald-600/10 data-[disabled=true]:opacity-50 dark:text-emerald-400"
            >
              ＋ Create “{q}”{!online && " (needs connection)"}
            </Command.Item>
          )}
          {q && listed.length === 0 && exactMatch === false && (
            <Command.Empty className="px-3 py-2 text-sm text-zinc-500">No matches.</Command.Empty>
          )}
        </Command.List>
      </Command>

      <ConfirmSheet
        open={dedupFor !== null}
        title={`Did you mean one of these?`}
        onClose={() => setDedupFor(null)}
      >
        {dedupFor && (
          <div className="flex flex-col gap-2">
            {dedupFor.candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                className="justify-between"
                onClick={() => {
                  setDedupFor(null);
                  pick(c.id, c.name);
                }}
              >
                <span>{c.name}</span>
                <span className="text-xs text-zinc-500">{Math.round(c.similarity * 100)}% similar</span>
              </Button>
            ))}
            <Button disabled={creating} onClick={() => void create(dedupFor.name)}>
              {creating ? "Creating…" : `No — create “${dedupFor.name}”`}
            </Button>
          </div>
        )}
      </ConfirmSheet>
    </div>
  );
}
