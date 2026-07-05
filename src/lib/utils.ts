/** Join conditional class names — the only styling utility we need without shadcn's cva. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
