"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { apiGet } from "@/lib/api-client";
import { didYouMean, searchOffline, type ExerciseMatch } from "@/lib/exercises/dedup";
import { normalizeExerciseName } from "@/lib/exercises/normalize";
import { suggestMuscleGroups } from "@/lib/exercises/suggest-tags";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmSheet } from "./ConfirmSheet";
import { CreateFields, defaultCreateOpts, type CreateOpts } from "./CreateFields";
import type { Exercise } from "@/types/db";

/**
 * The primary log door (ADR-0003): creatable combobox over the canonical list.
 * Online, candidates come from the search_exercises RPC; offline, from the
 * cached list via the client trigram mirror — so /log works in gym dead-zones.
 *
 * Create flow (business rules 1 + normalization brief): "Create X" ALWAYS opens
 * the confirm sheet — normalized name preview, any ≥0.5 did-you-mean matches,
 * and the bodyweight/unit fields (so new exercises land on the right PR track).
 * The user always chooses; nothing is auto-applied or blocked.
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
  onCreate: (name: string, opts: CreateOpts) => Promise<Exercise | null>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExerciseMatch[]>([]);
  const [createFor, setCreateFor] = useState<{ name: string; candidates: ExerciseMatch[] } | null>(null);
  const [createOpts, setCreateOpts] = useState<CreateOpts>(defaultCreateOpts);
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which create-sheet open a suggestion belongs to — a stale reply (sheet closed or
   *  reopened for another name) is discarded. */
  const suggestTokenRef = useRef(0);

  const byId = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!q) {
        setResults([]);
        return;
      }
      // Normalized query gives the trigram real word boundaries ("benchPress" → "Bench Press").
      const searchQ = normalizeExerciseName(q);
      if (online) {
        try {
          const data = await apiGet<{ results: ExerciseMatch[] }>(
            `/api/exercises?q=${encodeURIComponent(searchQ)}`,
          );
          setResults(data.results);
          return;
        } catch {
          // fall through to the offline mirror
        }
      }
      setResults(searchOffline(exercises, searchQ));
    }, q ? 200 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, online, exercises]);

  function pick(id: string, name: string) {
    const detail =
      byId.get(id) ??
      ({
        id,
        name,
        aliases: [],
        is_bodyweight: false,
        unit: "reps",
        muscle_groups: [],
        default_rest_seconds: null,
        default_cue: null,
        created_at: "",
      } as Exercise);
    setQuery("");
    setResults([]);
    onSelect(detail);
  }

  async function create() {
    if (!createFor) return;
    setCreating(true);
    try {
      const created = await onCreate(createFor.name, createOpts);
      if (created) {
        setCreateFor(null);
        setQuery("");
        setResults([]);
        onSelect(created);
      }
    } finally {
      setCreating(false);
    }
  }

  /** "Create X" entry point — always opens the confirm sheet (dedup + fields). */
  function requestCreate() {
    const name = normalizeExerciseName(query);
    if (!name) return;
    setCreateOpts(defaultCreateOpts);
    setCreateFor({ name, candidates: didYouMean(results) });
    void suggestTags(name);
  }

  /**
   * Fire the AI muscle-group suggestion on sheet open (auto-tagging brief). Pre-selects
   * the picker only if the owner hasn't already chosen tags — a suggestion never
   * overwrites the owner's edits, and a stale reply is dropped by the token guard.
   * Best-effort: any failure leaves the picker empty and the create flow unchanged.
   */
  async function suggestTags(name: string) {
    const token = ++suggestTokenRef.current;
    setSuggesting(true);
    const groups = await suggestMuscleGroups(name);
    if (token !== suggestTokenRef.current) return; // sheet closed or reopened for another name
    setSuggesting(false);
    if (groups.length === 0) return;
    setCreateOpts((prev) => (prev.muscle_groups.length === 0 ? { ...prev, muscle_groups: groups } : prev));
  }

  const q = query.trim();
  const normalized = q ? normalizeExerciseName(q) : "";
  const exactMatch = results.some((r) => r.name.toLowerCase() === normalized.toLowerCase());
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
              ＋ Create “{normalized}”{!online && " (needs connection)"}
            </Command.Item>
          )}
          {q && listed.length === 0 && exactMatch === false && (
            <Command.Empty className="px-3 py-2 text-sm text-zinc-500">No matches.</Command.Empty>
          )}
        </Command.List>
      </Command>

      <ConfirmSheet
        open={createFor !== null}
        title={createFor?.candidates.length ? "Did you mean one of these?" : `Create “${createFor?.name}”`}
        onClose={() => {
          suggestTokenRef.current++; // drop any in-flight suggestion for the closing sheet
          setSuggesting(false);
          setCreateFor(null);
        }}
      >
        {createFor && (
          <div className="flex flex-col gap-2">
            {createFor.candidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                className="justify-between"
                onClick={() => {
                  setCreateFor(null);
                  pick(c.id, c.name);
                }}
              >
                <span>{c.name}</span>
                <span className="text-xs text-zinc-500">{Math.round(c.similarity * 100)}% similar</span>
              </Button>
            ))}
            <CreateFields value={createOpts} onChange={setCreateOpts} suggesting={suggesting} />
            <Button disabled={creating} onClick={() => void create()}>
              {creating
                ? "Creating…"
                : createFor.candidates.length
                  ? `No — create “${createFor.name}”`
                  : `Create “${createFor.name}”`}
            </Button>
          </div>
        )}
      </ConfirmSheet>
    </div>
  );
}
