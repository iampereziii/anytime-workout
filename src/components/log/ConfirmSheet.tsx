"use client";

import type { ReactNode } from "react";

/**
 * Bottom sheet used for every user-decides moment on the log paths —
 * most importantly the "did you mean?" dedup confirm (business rule 1:
 * the user always chooses; nothing is auto-applied or blocked).
 */
export function ConfirmSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 shadow-xl dark:bg-zinc-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        <h2 className="mb-3 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
