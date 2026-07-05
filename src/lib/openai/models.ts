import "server-only";

/**
 * Model pins are LAW (project spec, business rule 8; challenge #3).
 *
 * Changing a pin requires updating the cost projection in the project spec:
 * c:/local-instance/ais/projects/any-time-workout/project-spec.md
 *
 * Projection basis (July 2026 pricing):
 *  - RECOMMENDATION_MODEL: GPT-5.4  ($2.50/$15 per 1M tok) → ~$6.6/mo @ 10 asks/day
 *  - PARSE_MODEL:          GPT-5.4-mini ($0.75/$4.50)      → ~$0.27/mo
 *  - Today-card recommendation: reuses the mini pin; fingerprint cache caps it at
 *    ~1–2 composition calls/day (regenerate only on a new log or date rollover)
 *    → << $0.10/mo. See feature brief ai-today-recommendation AC #4/#7.
 *  - Ceiling: $10/mo (ADR-0002 revisit trigger)
 */
export const RECOMMENDATION_MODEL = "gpt-5.4" as const;
export const PARSE_MODEL = "gpt-5.4-mini" as const;

/**
 * Today-card recommendation composer (feature brief: ai-today-recommendation).
 * A composition task, not conversation — reuses the mini pin. NOT a new pin:
 * same model value as PARSE_MODEL, aliased for a self-documenting call site.
 */
export const RECOMMENDATION_COMPOSE_MODEL = PARSE_MODEL;
