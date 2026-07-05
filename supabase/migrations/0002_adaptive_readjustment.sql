-- Any Time Workout — migration 0002: adaptive plan readjustment
-- Feature: c:/local-instance/ais/projects/any-time-workout/feature-brief-adaptive-plan-readjustment.md
-- Decision boundary: ADR-0005 (program is a baseline; adaptation at recommendation layer;
--   AI/chat never mutates program tables — the rows added here are HUMAN-authored seed edits).
--
-- Adds muscle-group tagging so recency overlap is computed by the app (Risk #1),
-- adds Floor Press + Jump Squat (program review, 2026-07-06), fixes the Home
-- equipment profile (no bench), and adds walk day-notes.
--
-- Apply-once, but written to be safe to re-run: this repo has no Supabase CLI
-- wired and the live DB is already seeded — paste this body into the Supabase
-- SQL editor once. seed.sql is updated in lockstep so a fresh `db reset`
-- reproduces the same end state.
--
-- Fresh-reset ordering: migrations run BEFORE seed. On an empty DB this migration
-- only adds the column + inserts the two new exercises (the tag/program/notes/
-- equipment statements no-op because their target rows don't exist yet); seed then
-- fills everything, its exercise insert guarded with `on conflict do nothing`.
-- On the already-seeded live DB (seed not re-run), the reverse holds and THIS file
-- does the tag backfill, program rows, notes, and bench fix.

begin;

-- ---------- schema: muscle groups on exercises (Risk #1: app-computed overlap) ----------
alter table exercises add column if not exists muscle_groups text[] not null default '{}';

-- ---------- new canonical exercises (program review 2026-07-06) ----------
insert into exercises (name, aliases, is_bodyweight, unit, muscle_groups) values
  ('Floor Press', array['floor press'], false, 'reps', array['chest','triceps']),
  ('Jump Squat',  array['jump squats'], true,  'reps', array['quads','glutes'])
on conflict do nothing;

-- ---------- backfill / set muscle-group tags (primary + secondary; empty = cardio/none) ----------
update exercises set muscle_groups = m.groups
from (values
  ('Incline Push-up',        array['chest','triceps','shoulders']),
  ('Push-up',                array['chest','triceps','shoulders']),
  ('Pull-up',                array['back','biceps']),
  ('Chin-up',                array['back','biceps']),
  ('Barbell Row',            array['back','biceps']),
  ('Overhead Press',         array['shoulders','triceps']),
  ('DB Shoulder Press',      array['shoulders','triceps']),
  ('Lateral Raise',          array['shoulders']),
  ('Plank',                  array['core']),
  ('Hanging Leg Raise',      array['core']),
  ('Squat',                  array['quads','glutes']),
  ('Romanian Deadlift',      array['hamstrings','glutes','back']),
  ('Deadlift',               array['back','hamstrings','glutes']),
  ('Lunge',                  array['quads','glutes']),
  ('Step-up',                array['quads','glutes']),
  ('Calf Raise',             array['calves']),
  ('Barbell Curl',           array['biceps']),
  ('Tricep Dip',             array['triceps','chest']),
  ('Floor Press',            array['chest','triceps']),
  ('Jump Squat',             array['quads','glutes']),
  ('Walk / Mobility',        array[]::text[]),
  ('Conditioning Intervals', array[]::text[])
) as m(name, groups)
where lower(exercises.name) = lower(m.name);

-- ---------- Floor Press → Day 1 slot 3 (chest volume fix + uses the barbell) ----------
-- Guarded so re-running is a no-op: only shift + insert when Floor Press is absent.
do $$
declare d1 uuid;
begin
  select pd.id into d1
  from program_days pd join programs p on p.id = pd.program_id and p.is_active
  where pd.day_number = 1;

  if d1 is not null and not exists (
    select 1 from planned_exercises pe join exercises e on e.id = pe.exercise_id
    where pe.program_day_id = d1 and lower(e.name) = 'floor press'
  ) then
    update planned_exercises set sort_order = sort_order + 1
    where program_day_id = d1 and sort_order >= 3;

    insert into planned_exercises (program_day_id, exercise_id, target_sets, target_reps, target_weight, rest_seconds, notes, sort_order)
    select d1, e.id, 4, 9, 32.5, 120, 'added 2026-07-06; start here, adjust to 1-2 RIR first session', 3
    from exercises e where lower(e.name) = 'floor press';
  end if;
end $$;

-- ---------- Jump Squat → Day 5 slot 1 (explosive intent before fatigue) ----------
do $$
declare d5 uuid;
begin
  select pd.id into d5
  from program_days pd join programs p on p.id = pd.program_id and p.is_active
  where pd.day_number = 5;

  if d5 is not null and not exists (
    select 1 from planned_exercises pe join exercises e on e.id = pe.exercise_id
    where pe.program_day_id = d5 and lower(e.name) = 'jump squat'
  ) then
    update planned_exercises set sort_order = sort_order + 1
    where program_day_id = d5;

    insert into planned_exercises (program_day_id, exercise_id, target_sets, target_reps, target_weight, rest_seconds, notes, sort_order)
    select d5, e.id, 3, 5, null, 120, 'explosive intent, first slot - before fatigue', 1
    from exercises e where lower(e.name) = 'jump squat';
  end if;
end $$;

-- ---------- walk day-notes on lifting days (aerobic gap fix); idempotent ----------
update program_days pd
set notes = trim(both ' ' from coalesce(pd.notes, '') || ' + 20-30 min walk, any time of day.')
from programs p
where pd.program_id = p.id and p.is_active
  and pd.day_number in (1, 2, 3, 5)
  and position('20-30 min walk' in coalesce(pd.notes, '')) = 0;

-- ---------- equipment fix: no bench at home (owner, 2026-07-06); idempotent ----------
update equipment_profiles
set items = array_remove(items, 'bench')
where lower(name) = 'home';

commit;
