"use client";

import { cn } from "@/lib/utils";
import type { ExerciseUnit } from "@/types/db";

/**
 * Bodyweight + unit fields for exercise creation (normalization brief, scope
 * add 2026-07-05): shown in BOTH create doors so new exercises land on the
 * right PR track — is_bodyweight decides reps-PRs vs weight-PRs (rule 3).
 */

export interface CreateOpts {
  is_bodyweight: boolean;
  unit: ExerciseUnit;
}

export const defaultCreateOpts: CreateOpts = { is_bodyweight: false, unit: "reps" };

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

export function CreateFields({ value, onChange }: { value: CreateOpts; onChange: (v: CreateOpts) => void }) {
  return (
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
  );
}
