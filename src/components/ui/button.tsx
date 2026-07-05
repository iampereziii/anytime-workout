import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal button primitive in the shadcn copy-in spirit (gap #3 resolution):
 * hand-copied styles, no runtime dependency.
 */

type Variant = "primary" | "ghost" | "danger" | "outline";

const variants: Record<Variant, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-zinc-400",
  ghost: "bg-transparent text-inherit hover:bg-zinc-100 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
  outline:
    "border border-zinc-300 dark:border-zinc-700 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
