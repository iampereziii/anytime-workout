import { apiPost } from "@/lib/api-client";

/**
 * Ask the AI to pre-select muscle-group tags for a NEW exercise name
 * (feature brief: ai-auto-tagging-new-exercises). Best-effort by design: ANY
 * failure — timeout, offline, model miss — resolves to `[]` so the create flow
 * is byte-for-byte unchanged and no error is ever surfaced (graceful absence).
 *
 * The returned tags are already vocabulary-validated server-side; the caller
 * pre-selects them in the picker, where the owner confirms or edits before save.
 */
export async function suggestMuscleGroups(name: string): Promise<string[]> {
  try {
    const { muscle_groups } = await apiPost<{ muscle_groups: string[] }>(
      "/api/exercises/suggest-tags",
      { name },
    );
    return muscle_groups;
  } catch {
    return [];
  }
}
