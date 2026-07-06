-- Any Time Workout — migration 0004: two-level muscle-group vocabulary + recency observability
-- Feature: c:/local-instance/ais/projects/any-time-workout/feature-brief-recency-first-today-recommendation.md
-- Decision boundary: ADR-0004 (overlap is app-computed, not model-inferred) and
--   ADR-0005/0006 (program is a PR baseline; adaptation at the recommendation layer,
--   never a program-table mutation — the rows touched here are HUMAN-authored seed
--   edits, i.e. sharper tags, not AI writes).
--
-- Three moves:
--   1. Re-tag the seed catalog to the fixed TWO-LEVEL vocabulary (sub-groups that
--      roll up to the 10 parents), so per-focus overlap reads at both levels.
--   2. Backfill user-created exercises that were recency-invisible — Diamond Push-up
--      (Risk #4: triceps, chest_mid, shoulders_front).
--   3. Add daily_recommendations.facts_block so a wrong-feeling suggestion is
--      auditable from the cache row alone (Risk #5).
--
-- The muscle_groups column stays an unconstrained text[] (added in 0002); the
-- vocabulary is enforced in app code (Zod enum built from src/lib/muscle-groups.ts),
-- so no CHECK constraint here (Risk #3 decision).
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once.
-- seed.sql is updated in lockstep so a fresh `db reset` reproduces the same tags.
-- Fresh-reset ordering (migrations before seed): on an empty DB the UPDATEs below
-- no-op (no rows yet) and the seed lands the two-level tags directly; on the live
-- (already-seeded) DB, seed is not re-run, so THIS file does the re-tag + backfill.

begin;

-- ---------- 1. re-tag seed catalog to the two-level vocabulary ----------
-- Most-specific level available; the app rolls sub-groups up to their parent, so
-- muscles without a meaningful sub-division (quads/hamstrings/calves) stay at the
-- parent level. Empty = cardio/none.
update exercises set muscle_groups = m.groups
from (values
  ('Incline Push-up',        array['chest_upper','triceps','shoulders_front']),
  ('Push-up',                array['chest_mid','triceps','shoulders_front']),
  ('Pull-up',                array['back_lats','biceps']),
  ('Chin-up',                array['back_lats','biceps']),
  ('Barbell Row',            array['back_upper','biceps']),
  ('Overhead Press',         array['shoulders_front','triceps']),
  ('DB Shoulder Press',      array['shoulders_front','triceps']),
  ('Lateral Raise',          array['shoulders_side']),
  ('Plank',                  array['core']),
  ('Hanging Leg Raise',      array['core_lower']),
  ('Squat',                  array['quads','glutes']),
  ('Romanian Deadlift',      array['hamstrings','glutes','back_lower']),
  ('Deadlift',               array['back_lower','hamstrings','glutes']),
  ('Lunge',                  array['quads','glutes']),
  ('Step-up',                array['quads','glutes']),
  ('Calf Raise',             array['calves']),
  ('Barbell Curl',           array['biceps']),
  ('Tricep Dip',             array['triceps','chest_lower']),
  ('Floor Press',            array['chest_mid','triceps','shoulders_front']),
  ('Jump Squat',             array['quads','glutes']),
  ('Walk / Mobility',        array[]::text[]),
  ('Conditioning Intervals', array[]::text[])
) as m(name, groups)
where lower(exercises.name) = lower(m.name);

-- ---------- 2. backfill user-created exercises (Risk #4) ----------
-- Diamond Push-up was combobox-created with no tags, so a third of the incident
-- session never reached the recency facts. Full push-pattern coverage (EMG-backed):
-- triceps-dominant, mid-chest, anterior-delt. Guarded on empty so a manual tag
-- (if the owner added one) is never clobbered.
update exercises
set muscle_groups = array['triceps','chest_mid','shoulders_front']
where lower(name) = 'diamond push-up' and cardinality(muscle_groups) = 0;

-- ---------- 3. observability: store the rendered facts block per cache row ----------
alter table daily_recommendations add column if not exists facts_block text;

commit;

-- ---------- post-migration verification (AC #4 — run once, then delete) ----------
-- Expect ZERO rows: every exercise that has logged sets is tagged, except the two
-- designated cardio/mobility movements. Any row returned is an untagged user-created
-- exercise the owner must tag (no auto-guess — a wrong tag corrupts recency).
-- select e.name
-- from exercises e
-- where cardinality(e.muscle_groups) = 0
--   and exists (select 1 from logged_sets ls where ls.exercise_id = e.id)
--   and lower(e.name) not in ('walk / mobility', 'conditioning intervals');
