"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPut } from "@/lib/api-client";
import type { RecommendationMode } from "@/lib/recommendation-mode";

/**
 * Recommendation-mode picker (feature brief: Adaptive Workout Planning). The
 * owner's dial on how far the coach may leave the planned program:
 *   Follow Program → Adapt Program → Coach Mode (least → most divergence).
 *
 * Like the EquipmentPicker, this is CONTEXT — switching the mode never edits the
 * program (ADR-0005); it changes how the card and chat compose. On a switch we
 * dispatch `atw:mode-changed` so the TodayStatus card re-fetches its suggestion
 * (a mode switch shifts the recommendation fingerprint → the card recomposes).
 */

export const MODE_CHANGED_EVENT = "atw:mode-changed";

interface ModeOption {
  mode: RecommendationMode;
  label: string;
}

export function RecommendationModePicker() {
  const [options, setOptions] = useState<ModeOption[] | null>(null);
  const [active, setActive] = useState<RecommendationMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ mode: RecommendationMode; options: ModeOption[] }>("/api/recommendation-mode")
      .then((d) => {
        setActive(d.mode);
        setOptions(d.options);
      })
      .catch(() => setError("Couldn't load recommendation mode"));
  }, []);

  async function choose(mode: RecommendationMode) {
    if (busy || mode === active) return;
    setBusy(true);
    setError(null);
    const previous = active;
    setActive(mode); // optimistic
    try {
      await apiPut("/api/recommendation-mode", { mode });
      // Tell the card its suggestion is stale for the new mode.
      window.dispatchEvent(new CustomEvent(MODE_CHANGED_EVENT));
    } catch {
      setActive(previous); // reconcile on failure
      setError("Couldn't switch mode — try again");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!options || active === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-zinc-500">Coaching:</span>
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          onClick={() => choose(o.mode)}
          disabled={busy}
          aria-pressed={o.mode === active}
          className={
            o.mode === active
              ? "rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white dark:bg-emerald-500"
              : "rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
