"use client";

import { cn } from "@/lib/utils";
import { PARENT_GROUPS, SUBGROUPS } from "@/lib/muscle-groups";
import type { ExerciseUnit } from "@/types/db";

/**
 * Bodyweight + unit + muscle-group fields for exercise creation. Shown in BOTH
 * create doors so a new exercise lands on the right PR track (is_bodyweight,
 * normalization brief) AND is recency-visible at birth (muscle_groups,
 * recency-first brief) — recency must never go blind again. Tags are the fixed
 * two-level vocabulary; empty is allowed for cardio/mobility.
 */

export interface CreateOpts {
  is_bodyweight: boolean;
  unit: ExerciseUnit;
  muscle_groups: string[];
}

export const defaultCreateOpts: CreateOpts = { is_bodyweight: false, unit: "reps", muscle_groups: [] };

function Segmented<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 rounded-md py-1.5 text-sm",
              value === o.value ? "bg-white font-medium shadow dark:bg-zinc-900" : "text-zinc-500",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </label>
  );
}

function Chip({
  label,
  active,
  strong,
  onClick,
}: {
  label: string;
  active: boolean;
  strong?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-xs",
        active ? "bg-emerald-600 text-white" : "bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300",
        strong && "font-semibold",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Two-level muscle-group picker (recency-first brief). Parent chip + its
 * sub-group chips per row; multi-select; empty is a valid choice (cardio). A tag
 * may be a parent OR a sub-group — the recency engine rolls sub-groups up to
 * their parent, so tagging at either level reads correctly.
 */
function MuscleGroupPicker({
  value,
  onChange,
  suggesting,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  suggesting?: boolean;
}) {
  const selected = new Set(value);
  function toggle(group: string) {
    const next = new Set(selected);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    onChange([...next]);
  }
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      <span className="flex items-center gap-1.5">
        Muscle groups (drives recency — leave empty for cardio/mobility)
        {suggesting && <span className="text-emerald-600 dark:text-emerald-400">· suggesting…</span>}
      </span>
      <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
        {PARENT_GROUPS.map((parent) => (
          <div key={parent} className="flex flex-wrap items-center gap-1">
            <Chip label={parent} active={selected.has(parent)} strong onClick={() => toggle(parent)} />
            {SUBGROUPS[parent].map((sub) => (
              <Chip
                key={sub}
                label={sub.slice(parent.length + 1)}
                active={selected.has(sub)}
                onClick={() => toggle(sub)}
              />
            ))}
          </div>
        ))}
      </div>
    </label>
  );
}

export function CreateFields({
  value,
  onChange,
  suggesting,
}: {
  value: CreateOpts;
  onChange: (v: CreateOpts) => void;
  /** True while the AI tag suggestion for this exercise is in flight (auto-tagging brief). */
  suggesting?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Segmented
          label="Load type (drives PR tracking)"
          options={[
            { label: "Weighted", value: false },
            { label: "Bodyweight", value: true },
          ]}
          value={value.is_bodyweight}
          onChange={(is_bodyweight) => onChange({ ...value, is_bodyweight })}
        />
        <Segmented
          label="Measured in"
          options={[
            { label: "reps", value: "reps" as const },
            { label: "sec", value: "seconds" as const },
            { label: "min", value: "minutes" as const },
          ]}
          value={value.unit}
          onChange={(unit) => onChange({ ...value, unit })}
        />
      </div>
      <MuscleGroupPicker
        value={value.muscle_groups}
        onChange={(muscle_groups) => onChange({ ...value, muscle_groups })}
        suggesting={suggesting}
      />
    </div>
  );
}
