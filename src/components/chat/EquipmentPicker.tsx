"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPut } from "@/lib/api-client";

/**
 * Equipment/location picker (feature brief Risk #4): the persistent signal for
 * adaptive readjustment. Switching the active profile is CONTEXT, not a program
 * edit — it stays inside the ADR-0005 boundary. The coach reads the active
 * profile from the facts block on the next question.
 */

interface Profile {
  id: string;
  name: string;
  items: string[];
  is_active: boolean;
}

export function EquipmentPicker() {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ profiles: Profile[] }>("/api/equipment-profiles")
      .then((d) => setProfiles(d.profiles))
      .catch(() => setError("Couldn't load equipment profiles"));
  }, []);

  async function choose(id: string) {
    if (busyId || profiles?.find((p) => p.id === id)?.is_active) return;
    setBusyId(id);
    setError(null);
    // Optimistic: flip active locally, reconcile on failure.
    setProfiles((prev) => prev?.map((p) => ({ ...p, is_active: p.id === id })) ?? prev);
    try {
      await apiPut("/api/equipment-profiles", { id });
    } catch {
      setError("Couldn't switch profile — try again");
      apiGet<{ profiles: Profile[] }>("/api/equipment-profiles")
        .then((d) => setProfiles(d.profiles))
        .catch(() => {});
    } finally {
      setBusyId(null);
    }
  }

  // Hide entirely until loaded; a single profile still shows (confirms context).
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!profiles || profiles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-zinc-500">Equipment:</span>
      {profiles.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => choose(p.id)}
          disabled={busyId !== null}
          aria-pressed={p.is_active}
          className={
            p.is_active
              ? "rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white dark:bg-emerald-500"
              : "rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300"
          }
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
