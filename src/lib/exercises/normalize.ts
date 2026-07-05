/**
 * Exercise-name normalization (feature brief: exercise-name-normalization).
 * ONE function, used by both the server (authoritative, POST /api/exercises)
 * and the client (create-preview + dedup-query hygiene). Input hygiene for the
 * trigram matcher (ADR-0003) — camelCase has no word boundaries, so unsplit
 * names score artificially low against their spaced twins.
 *
 * Rule (confirmed 2026-07-05): split camel/PascalCase → strip dangling hyphens
 * → collapse whitespace → Title Case → known short tokens stay ALL-CAPS.
 * Hyphenated compounds follow the seed style: "Push-up", not "Push-Up".
 */

/** Tokens that are always uppercased (equipment/movement abbreviations). */
const CAPS_TOKENS = new Set(["DB", "BW", "RDL", "OHP"]);

function casePart(part: string, isFirst: boolean): string {
  if (part === "") return part;
  const upper = part.toUpperCase();
  if (CAPS_TOKENS.has(upper)) return upper;
  // All-caps short tokens the user typed deliberately (≤3 chars) stay as-is —
  // standalone words only; sub-parts of hyphen compounds follow seed style ("Push-up").
  if (isFirst && part.length <= 3 && part === upper && /[A-Z]/.test(part)) return part;
  const lower = part.toLowerCase();
  // Seed style: first sub-word of a hyphenated compound is capitalized, the rest stay lower ("Push-up").
  return isFirst ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
}

export function normalizeExerciseName(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase / PascalCase boundary → space
    .replace(/-+(\s|$)/g, "$1") // dangling hyphen ("Diamond- " → "Diamond ")
    .replace(/(^|\s)-+/g, "$1") // leading hyphen on a word
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part, i) => casePart(part, i === 0))
        .join("-"),
    )
    .join(" ");
}
