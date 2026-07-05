/**
 * The dedup brain (ADR-0003 / business rules 1–2) — ONE brain, two doors.
 * Both the combobox and the parse path resolve names through this module.
 *
 * Online, candidates come from the search_exercises RPC (pg_trgm). Offline,
 * `searchOffline` mirrors the RPC with a client-side trigram approximation so
 * /log keeps working in gym dead-zones (business rule 10). The server RPC is
 * the source of truth whenever the network is up.
 */

/** Spike-validated did-you-mean threshold (ADR-0003). */
export const DEDUP_THRESHOLD = 0.5;

/** Broad candidate net the RPC uses for combobox ranking. */
export const CANDIDATE_NET = 0.15;

/** Row shape of the search_exercises RPC (and its offline mirror). */
export interface ExerciseMatch {
  id: string;
  name: string;
  similarity: number;
  matched_alias: boolean;
}

/**
 * Candidates to show in "did you mean?" — a LIST, never a verdict.
 * Creation is never blocked and matches are never auto-applied (rule 1);
 * the user always chooses.
 */
export function didYouMean(results: ExerciseMatch[]): ExerciseMatch[] {
  return results.filter((r) => r.similarity >= DEDUP_THRESHOLD);
}

/** pg_trgm-style word trigrams: lowercase, strip punctuation, pad each word with 2 leading + 1 trailing space. */
function trigramsOf(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams = new Set<string>();
  for (const w of words) {
    const padded = `  ${w} `;
    for (let i = 0; i <= padded.length - 3; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/** Jaccard similarity over trigram sets — the same formula pg_trgm uses. */
export function trigramSimilarity(a: string, b: string): number {
  const ga = trigramsOf(a);
  const gb = trigramsOf(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

export interface SearchableExercise {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * Offline mirror of the search_exercises RPC: trigram on name + exact
 * (case-insensitive) alias match at similarity 1.0, net > 0.15, top 10.
 * "RDL" must find Romanian Deadlift offline too (business rule 12).
 */
export function searchOffline(list: SearchableExercise[], q: string): ExerciseMatch[] {
  const query = q.trim();
  if (!query) return [];
  const lowered = query.toLowerCase();
  return list
    .map((e) => {
      const aliasHit = e.aliases.some((a) => a.toLowerCase() === lowered);
      const sim = Math.max(trigramSimilarity(e.name, query), aliasHit ? 1.0 : 0);
      return { id: e.id, name: e.name, similarity: sim, matched_alias: aliasHit };
    })
    .filter((m) => m.similarity > CANDIDATE_NET || m.matched_alias)
    .sort((a, b) => b.similarity - a.similarity || a.name.localeCompare(b.name))
    .slice(0, 10);
}
