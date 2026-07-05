-- Any Time Workout — migration 0003: Today recommendation cache
-- Feature: c:/local-instance/ais/projects/any-time-workout/feature-brief-ai-today-recommendation.md
-- Decision boundary: ADR-0005 (program is baseline; adaptation lives at the
--   recommendation layer). This table is a CACHE of composed recommendations —
--   it never mutates program_days / planned_exercises.
--
-- Cost discipline (repo rule 5 / AC #4): the Today card triggers an UNPROMPTED
-- model call on page load. To hold the < $10/mo ceiling, the recommendation is
-- regenerated ONLY when the underlying facts change. The fingerprint (today's
-- date + latest session id) is the change signal: a new log inserts a new
-- workout_sessions row (POST /api/log) and a date rollover changes the date, so
-- either one shifts the fingerprint → natural cache miss → regenerate. Repeat
-- home-screen loads on the same fingerprint are pure cache hits: zero model calls.
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once.
-- On a fresh `db reset`, migrations run before seed; this table needs no seed data.

begin;

create table if not exists daily_recommendations (
  id          uuid primary key default gen_random_uuid(),
  -- Local calendar day the recommendation is for (yyyy-mm-dd).
  rec_date    date not null,
  -- Facts fingerprint: today's date + latest session id. A new log or a date
  -- rollover changes this, giving a natural miss without an invalidation hook.
  fingerprint text not null,
  -- The composed card payload (suggested_focus, headline, reason, divergence,
  -- suggested lifts). Stored whole so a cache hit is a single row read.
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  -- One cached recommendation per fingerprint; the route upserts on this.
  unique (fingerprint)
);

-- Cheap pruning / newest-first lookups by day.
create index if not exists daily_recommendations_date on daily_recommendations (rec_date desc);

-- RLS enabled, no policies (deny-all for anon/authenticated) — matches every
-- other table (0001): all access is server-side via the service role, which
-- bypasses RLS. Defense-in-depth against the anon key.
alter table daily_recommendations enable row level security;

commit;
