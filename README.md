# Any Time Workout

> Personal AI workout companion — exact, history-grounded answers about your training.

## What is this?

A single-user, mobile-first Next.js PWA for logging workouts and asking
natural-language questions ("what should I train today?", "when did I last do
squats?"). Answers are grounded in real workout history stored in Supabase.

The core architectural law: **the app computes facts deterministically in code
(days-since, remaining sets, PR targets in `src/lib/facts`); the AI only
composes recommendations from those facts.** Cost discipline is a feature —
OpenAI model pins live in [models.ts](src/lib/openai/models.ts) with a
$10/month ceiling.

Architecture decisions (ADRs, project spec, business rules) live in the `ais`
repo at `ais/projects/any-time-workout/` — this repo links to them, never
duplicates them.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.9+ | Required by Next.js 16 |
| npm | 10+ | Ships with Node 20 |
| Supabase project | Free tier | Postgres with `pg_trgm`; you need the URL and service role key |
| OpenAI API key | — | Fund with prepaid credits, auto-recharge OFF (see `.env.example`) |

## Getting started

### Install

```bash
git clone <repo-url> any-time-workout
cd any-time-workout
npm install
```

### Environment configuration

```bash
cp .env.example .env.local
```

Fill in every variable — all are required; the app fails fast at boot if
`APP_TIMEZONE` is missing rather than deriving the wrong calendar day on a
UTC server.

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Server-only. Chat answers, free-text parse, tag suggestions |
| `APP_PASSWORD` | Shared password for the login gate |
| `SESSION_SECRET` | Signs the httpOnly session cookie |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. All DB access goes through the server |
| `APP_TIMEZONE` | IANA timezone of the owner (e.g. `Asia/Manila`) — source of "today" |
| `PORT` | Optional. Used by `npm run start:lan` (defaults to 3000) |

Never commit `.env.local`.

### Database setup

Apply the migrations in [supabase/migrations/](supabase/migrations/) to your
Supabase project in numeric order (Supabase SQL editor or `supabase db push`),
then run [supabase/seed.sql](supabase/seed.sql) to load the starter exercise
catalog.

### Run locally

```bash
npm run dev
```

Open http://localhost:3000 — you'll land on the login gate; sign in with
`APP_PASSWORD`. Routes: `/` (chat + today status), `/log` (workout logging),
`/login`.

## How to run

### Development

```bash
npm run dev        # dev server on :3000
npm run typecheck  # tsc --noEmit — must pass
npm run lint
```

### Testing

```bash
npm test           # Vitest, single run
npm run test:watch
```

Every business rule in the project spec has at least one test; `lib/facts`
targets full coverage.

### Phone on the same Wi-Fi (Windows)

```bash
npm run start:lan
```

Builds and serves the production app bound to `0.0.0.0`, adding a Windows
Firewall rule for the port on first run (expect a UAC prompt). Open
`http://<this-PC's-LAN-IP>:<port>` on your phone.

### Deploy

Deployed on Vercel (free tier). Set the same environment variables in the
Vercel project settings.

## Tips and gotchas

- **Auth middleware must live in `src/middleware.ts`** — a root-level
  `middleware.ts` is silently ignored when a `src/` directory exists.
- **Supabase and OpenAI are server-only boundaries.** No client-side DB
  queries; the service role key and OpenAI key must never reach the browser.
- **Model pins are law.** Changing a model in
  [models.ts](src/lib/openai/models.ts) requires updating the cost projection
  in the project spec. Anything that adds model calls needs a cost note in
  the PR.
- **Never let the model compute facts.** Date math, remaining sets, and PR
  targets come from `src/lib/facts` — if a prompt change makes the model
  recompute or contradict the facts block, that's a bug.
- **No silent exercise auto-merge.** Dedup (pg_trgm, similarity ≥ 0.5) only
  ever shows a "did you mean?" prompt; the user always decides.
- **`server-only` imports in tests** are stubbed via an alias in
  [vitest.config.ts](vitest.config.ts) — server modules stay unit-testable
  without a React Server Components bundle.

## Contributing

Personal project, single maintainer. Branches are named
`feat|fix|chore/<short-description>`, commits follow conventional commits,
PRs target `main`. Scope is frozen for v1 — new ideas go to the v1.1 list in
the `ais` repo, not into code.
