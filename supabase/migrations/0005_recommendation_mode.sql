-- Any Time Workout — migration 0005: Recommendation mode (app_settings)
-- Feature: Adaptive Workout Planning — Recommendation Modes.
-- Decision boundary: ADR-0005 (program is baseline; adaptation lives at the
--   recommendation layer). The mode is CONTEXT, not program data — like the
--   active equipment profile (0002) it tunes how recommendations are composed
--   and never mutates program_days / planned_exercises.
--
-- Single-user app (project spec): a singleton settings row (id = 1) is the whole
-- store. The mode folds into the recommendation cache fingerprint (lib/facts
-- `recommendationFingerprint`), so switching modes is a natural cache miss →
-- recompose, with no invalidation hook and no extra cost on steady-state reloads.
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once.
-- On a fresh `db reset`, migrations run before seed; the default row is seeded here.

begin;

create table if not exists app_settings (
  -- Enforced singleton: exactly one row, always id = 1.
  id                  smallint primary key default 1 check (id = 1),
  -- follow | adapt | coach — see src/lib/recommendation-mode.ts (the app-side
  -- enforcement point). Constrained here too so no junk mode reaches a read.
  recommendation_mode text not null default 'adapt'
    check (recommendation_mode in ('follow', 'adapt', 'coach')),
  updated_at          timestamptz not null default now()
);

-- Seed the singleton with the default mode. Idempotent.
insert into app_settings (id, recommendation_mode) values (1, 'adapt')
  on conflict (id) do nothing;

-- RLS enabled, no policies (deny-all for anon/authenticated) — matches every
-- other table (0001): all access is server-side via the service role, which
-- bypasses RLS. Defense-in-depth against the anon key.
alter table app_settings enable row level security;

commit;
