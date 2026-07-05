# CLAUDE.md — Any Time Workout

## Purpose

Personal, single-user, AI-powered workout companion (mobile-first Next.js PWA). The owner asks natural-language workout questions and logs workouts; answers are grounded in their real history. **Core architectural law: the app computes facts (days-since, remaining exercises, PR targets) deterministically in code; the AI only composes recommendations.** This split is the product's reason to exist — see ADR-0004.

- **Client:** Personal (Perez)
- **Primary user:** owner only — no multi-user features in v1
- **Core goal:** exact, history-grounded workout answers at hobby cost (< $10/mo OpenAI)

**Architecture docs live in the ais repo:** `c:/local-instance/ais/projects/any-time-workout/` — [project-spec.md](c:/local-instance/ais/projects/any-time-workout/project-spec.md), four Accepted ADRs, discovery doc, and the challenge review. Decisions are made there; code happens here.

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js (App Router) | TypeScript strict, PWA |
| Database | Supabase (Postgres, free tier) | `pg_trgm` + GIN index; access via supabase-js + RPC, **server-side only** |
| AI | OpenAI | **Pinned:** GPT-5.4 (chat) / GPT-5.4-mini (parse) in `src/lib/openai/models.ts`; Structured Outputs for all JSON |
| Auth | Shared password → signed httpOnly cookie | `middleware.ts` gate covers `/api/*` |
| Infra | Vercel free tier | |
| Styling | Tailwind CSS + shadcn/ui | cmdk combobox for exercise picker |

---

## Structure

```
src/
  app/            # pages: / (chat+status), /log, /login; api/: login, chat, exercises, parse, log, program
  components/     # ui/ (shadcn), chat/, log/ (ExerciseCombobox, ConfirmSheet)
  lib/
    facts/        # ★ OWNER-WRITTEN deterministic facts layer — see How to Engage #2
    openai/       # client, model pins, Structured Output schemas
    supabase/     # server client (service role)
    offline/      # exercise-list cache + offline write queue
    validators/   # Zod schemas
  middleware.ts   # ★ OWNER-WRITTEN auth gate — MUST live in src/ (root middleware is ignored when src/ exists; found the hard way 2026-07-05)
supabase/         # migrations (schema, pg_trgm, RPC, pr_bests view) + seed.sql
tests/
```

---

## Conventions

### Git
- Branch naming: `feat|fix|chore/<short-description>` (no ticket system — personal project)
- PRs target: `main`
- Commit style: conventional commits

### Code Style
- TypeScript strict; `tsc --noEmit` must pass; no `any` — `unknown` + type guards
- API responses: `{ data } | { error: { code, message } }` — no ad-hoc shapes

### Testing
- Unit: Vitest — `npm test`. Every business rule in the project-spec has at least one test; `lib/facts` targets full coverage.

---

## Key Integrations

| Integration | Purpose | Notes |
|-------------|---------|-------|
| Supabase | All persistence | Server-side only (service role key); no client-side DB queries in v1 |
| OpenAI | Chat answers + free-text parse | Server-only; pins are law — changing a model requires updating the cost projection in the project-spec |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Server-only |
| `APP_PASSWORD` | Yes | Login gate shared secret |
| `SESSION_SECRET` | Yes | Session cookie signing |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only |

Copy `.env.example` → `.env.local`. Never commit `.env.local`.

---

## How to Engage

1. **The ADRs are settled — don't re-litigate.** Prompt-stuffing (not tool-use), combobox-primary logging with pg_trgm dedup at threshold 0.5 (not embeddings), rules-compute/AI-composes. Each has documented revisit triggers in the ais repo; propose a revisit only when a trigger fires.
2. **Teach-mode revisit pending: `middleware.ts`, `src/lib/auth/session.ts`, `src/lib/facts/**`.** Originally the owner-written learning scope; the owner overruled on 2026-07-05 (delivery priority) and the AI implemented all three against the pre-written guide tests (24/24 green). The tests and teaching comments remain the revisit material — when the owner returns to learn these, offer either a walkthrough (`/explain`) or the full loop: delete the implementation bodies and re-derive red→green. Do not treat the revisit as optional forever — surface it when the sprint pressure is off.
3. **Never let the model compute facts.** Date math, remaining-sets, PR targets are code (`lib/facts`). If a prompt change makes the model recompute or contradict the facts block, that's a bug.
4. **No silent exercise auto-merge — ever.** Dedup shows "did you mean?" (similarity ≥ 0.5); the user always decides. Both log paths route through the same interactive confirm.
5. **Cost discipline is a feature.** Model pins live in one file; the $10/mo ceiling and ~$6.9/mo projection are in the project-spec. Anything that adds model calls (new features, retries, chattier prompts) gets a one-line cost note in the PR.
6. **Confirm before save on the parse path.** Parsed free-text is never persisted without explicit user confirmation; ambiguous input gets one clarifying question, never a junk write.
7. **For "current best practice" questions** (Next.js PWA/service-worker especially — flagged unverified at spec time) — use WebSearch; don't trust training-time knowledge.

---

## What Doesn't Belong Here

- **Architecture/decision docs** — they live in `c:/local-instance/ais/projects/any-time-workout/`; this repo links to them, never duplicates them
- **Multi-user features, charts, streaks, social** — v1 scope is frozen; ideas go to the v1.1 list in the ais repo, not into code
- **Client-side secrets or DB access** — OpenAI and Supabase are server-only boundaries
- Credentials, API keys, `.env.local` — never commit

---

## References

- [Project Spec](c:/local-instance/ais/projects/any-time-workout/project-spec.md) — data model, routes, the 12 business rules, acceptance criteria
- [ADRs 0001–0004](c:/local-instance/ais/projects/any-time-workout/decisions/) — Accepted, challenge-reviewed 2026-07-05
- [Challenge Review](c:/local-instance/ais/projects/any-time-workout/decisions/challenge-v1-architecture-adrs-2026-07-05.md) — the 8 findings this build must honor
