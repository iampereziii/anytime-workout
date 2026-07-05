-- Any Time Workout — seed data
-- Source of truth: c:/local-instance/ais/projects/any-time-workout/program-source.md (2026-07-05)
-- Owner-confirmed aliases: elevated push-up → Incline Push-up; dips → Tricep Dip (Flags A/B).
-- Baseline history seeding: owner's call (Flag C) — last actuals as one week of sessions.

begin;

-- ---------- canonical exercises ----------
-- muscle_groups (col added in migration 0002): primary + secondary; empty = cardio/none.
-- Feeds app-computed per-muscle-group recency (adaptive-readjustment feature, Risk #1).
insert into exercises (name, aliases, is_bodyweight, unit, muscle_groups) values
  ('Incline Push-up',       array['incline pushup','elevated push-up','elevated pushup'], true,  'reps',    array['chest','triceps','shoulders']),
  ('Push-up',               array['pushup','regular push-up'],                            true,  'reps',    array['chest','triceps','shoulders']),
  ('Pull-up',               array['pullup'],                                              true,  'reps',    array['back','biceps']),
  ('Chin-up',               array['chinup'],                                              true,  'reps',    array['back','biceps']),
  ('Barbell Row',           array['bb row'],                                              false, 'reps',    array['back','biceps']),
  ('Overhead Press',        array['OHP'],                                                 false, 'reps',    array['shoulders','triceps']),
  ('DB Shoulder Press',     array['dumbbell shoulder press'],                             false, 'reps',    array['shoulders','triceps']),
  ('Lateral Raise',         array['lateral raises'],                                      false, 'reps',    array['shoulders']),
  ('Plank',                 array[]::text[],                                              true,  'seconds', array['core']),
  ('Hanging Leg Raise',     array[]::text[],                                              true,  'reps',    array['core']),
  ('Squat',                 array['squats'],                                              false, 'reps',    array['quads','glutes']),
  ('Romanian Deadlift',     array['RDL','romanian dead lift'],                            false, 'reps',    array['hamstrings','glutes','back']),
  ('Deadlift',              array[]::text[],                                              false, 'reps',    array['back','hamstrings','glutes']),
  ('Lunge',                 array['lunges'],                                              false, 'reps',    array['quads','glutes']),
  ('Step-up',               array['step ups'],                                            false, 'reps',    array['quads','glutes']),
  ('Calf Raise',            array['calf raises'],                                         true,  'reps',    array['calves']),
  ('Barbell Curl',          array['bb curl'],                                             false, 'reps',    array['biceps']),
  ('Tricep Dip',            array['dips'],                                                true,  'reps',    array['triceps','chest']),
  ('Floor Press',           array['floor press'],                                         false, 'reps',    array['chest','triceps']),
  ('Jump Squat',            array['jump squats'],                                         true,  'reps',    array['quads','glutes']),
  ('Walk / Mobility',       array['walk','mobility'],                                     true,  'minutes', array[]::text[]),
  ('Conditioning Intervals',array['intervals'],                                           true,  'minutes', array[]::text[])
-- on conflict: migration 0002 runs before seed on a fresh reset and inserts
-- Floor Press + Jump Squat; skip them here rather than aborting the seed txn.
on conflict do nothing;

-- ---------- program ----------
insert into programs (name, is_active) values ('6-Day Split v1', true);

insert into program_days (program_id, day_number, label, notes)
select p.id, d.n, d.label, d.notes
from programs p,
(values
  (1, 'Upper Body — Chest + Back', '+ 20-30 min walk, any time of day.'),
  (2, 'Lower Body', '+ 20-30 min walk, any time of day.'),
  (3, 'Arms + Shoulders', '+ 20-30 min walk, any time of day.'),
  (4, 'Active Recovery', 'Walk / Mobility, 20–30 min'),
  (5, 'Full Body — Power Day', '+ 20-30 min walk, any time of day.'),
  (6, 'Conditioning', 'Intervals 30s work / 60s rest ×10 (~15 min) OR incline walk 20 min'),
  (7, 'Rest', 'Full rest — recovery')
) as d(n, label, notes)
where p.name = '6-Day Split v1';

-- planned exercises (helper: day n, exercise name, sets, reps, weight, rest s, notes, order)
insert into planned_exercises (program_day_id, exercise_id, target_sets, target_reps, target_weight, rest_seconds, notes, sort_order)
select pd.id, e.id, v.sets, v.reps, v.weight, v.rest, v.notes, v.ord
from (values
  -- Day 1  (Floor Press added 2026-07-06 at slot 3 — chest volume + uses the barbell)
  (1, 'Incline Push-up',   4, 12,   null::numeric, 120, 'BW or +10 lbs',                 1),
  (1, 'Pull-up',           4, 8,    null,          120, null,                            2),
  (1, 'Floor Press',       4, 9,    32.5,          120, 'added 2026-07-06; adjust to 1-2 RIR', 3),
  (1, 'Barbell Row',       4, 12,   32.5,          180, 'slow',                          4),
  (1, 'Overhead Press',    3, 12,   25,            120, null,                            5),
  (1, 'Lateral Raise',     4, 12,   12.5,          60,  null,                            6),
  (1, 'Plank',             3, 60,   null,          60,  null,                            7),
  -- Day 2
  (2, 'Squat',             4, 14,   17.5,          120, null,                            1),
  (2, 'Romanian Deadlift', 4, 12,   32.5,          120, null,                            2),
  (2, 'Lunge',             3, 12,   10,            120, null,                            3),
  (2, 'Calf Raise',        4, 20,   10,            60,  'BW +10',                        4),
  -- Day 3
  (3, 'Chin-up',           4, 7,    null,          180, null,                            1),
  (3, 'DB Shoulder Press', 4, 12,   15,            120, null,                            2),
  (3, 'Barbell Curl',      3, 12,   17.5,          120, 'slow negatives',                3),
  (3, 'Tricep Dip',        3, 12,   10,            120, 'BW +10',                        4),
  (3, 'Lateral Raise',     4, 12,   12.5,          60,  null,                            5),
  (3, 'Hanging Leg Raise', 3, 12,   null,          60,  null,                            6),
  -- Day 5  (Jump Squat added 2026-07-06 at slot 1 — explosive intent before fatigue)
  (5, 'Jump Squat',        3, 5,    null,          120, 'explosive intent, first slot',  1),
  (5, 'Deadlift',          4, 9,    32.5,          180, 'slow negatives + 10-sec hold',  2),
  (5, 'Push-up',           3, null, null,          120, 'max reps (AMRAP)',              3),
  (5, 'Step-up',           3, 12,   10,            120, 'weight if available',           4),
  (5, 'Barbell Row',       3, 12,   32.5,          120, 'slow',                          5),
  (5, 'Plank',             3, 60,   null,          60,  'or Hanging Leg Raise ×12',      6)
) as v(day_n, ex_name, sets, reps, weight, rest, notes, ord)
join program_days pd on pd.day_number = v.day_n
join programs p      on p.id = pd.program_id and p.name = '6-Day Split v1'
join exercises e     on lower(e.name) = lower(v.ex_name);

-- ---------- baseline history (Flag C: owner's last actuals as one seed week) ----------
-- Dated across the week before build (2026-06-29 .. 2026-07-03).
-- Assumptions flagged in program-source.md:
--  * Incline Push-up logged as pure BW (source "BW / +10" ambiguous) — owner can edit.
--  * Day 5 Deadlift "9 target": seeded 9/9/9/9. Push-up AMRAP: no actuals given — omitted.

insert into workout_sessions (date, part, notes) values
  ('2026-06-29', null, 'seed: Day 1 baseline actuals'),
  ('2026-06-30', null, 'seed: Day 2 baseline actuals'),
  ('2026-07-01', null, 'seed: Day 3 baseline actuals'),
  ('2026-07-03', null, 'seed: Day 5 baseline actuals');

insert into logged_sets (session_id, exercise_id, set_number, reps, weight)
select ws.id, e.id, v.set_n, v.reps, v.weight
from (values
  -- Day 1 (2026-06-29): Incline Push-up 12/12/11/10, Pull-up 8/8/7/7, Row 12/12/10/10 @32.5,
  --                     OHP 12/12/12 @25, Lat Raise 12x4 @12.5, Plank 60/55/50s
  ('2026-06-29', 'Incline Push-up',   1, 12, null::numeric), ('2026-06-29', 'Incline Push-up',   2, 12, null),
  ('2026-06-29', 'Incline Push-up',   3, 11, null),          ('2026-06-29', 'Incline Push-up',   4, 10, null),
  ('2026-06-29', 'Pull-up',           1, 8,  null),          ('2026-06-29', 'Pull-up',           2, 8,  null),
  ('2026-06-29', 'Pull-up',           3, 7,  null),          ('2026-06-29', 'Pull-up',           4, 7,  null),
  ('2026-06-29', 'Barbell Row',       1, 12, 32.5),          ('2026-06-29', 'Barbell Row',       2, 12, 32.5),
  ('2026-06-29', 'Barbell Row',       3, 10, 32.5),          ('2026-06-29', 'Barbell Row',       4, 10, 32.5),
  ('2026-06-29', 'Overhead Press',    1, 12, 25),            ('2026-06-29', 'Overhead Press',    2, 12, 25),
  ('2026-06-29', 'Overhead Press',    3, 12, 25),
  ('2026-06-29', 'Lateral Raise',     1, 12, 12.5),          ('2026-06-29', 'Lateral Raise',     2, 12, 12.5),
  ('2026-06-29', 'Lateral Raise',     3, 12, 12.5),          ('2026-06-29', 'Lateral Raise',     4, 12, 12.5),
  ('2026-06-29', 'Plank',             1, 60, null),          ('2026-06-29', 'Plank',             2, 55, null),
  ('2026-06-29', 'Plank',             3, 50, null),
  -- Day 2 (2026-06-30): Squat 14/14/14/13 @17.5, RDL 12x4 @32.5, Lunge 12x3 @10, Calf Raise 20x4 +10
  ('2026-06-30', 'Squat',             1, 14, 17.5),          ('2026-06-30', 'Squat',             2, 14, 17.5),
  ('2026-06-30', 'Squat',             3, 14, 17.5),          ('2026-06-30', 'Squat',             4, 13, 17.5),
  ('2026-06-30', 'Romanian Deadlift', 1, 12, 32.5),          ('2026-06-30', 'Romanian Deadlift', 2, 12, 32.5),
  ('2026-06-30', 'Romanian Deadlift', 3, 12, 32.5),          ('2026-06-30', 'Romanian Deadlift', 4, 12, 32.5),
  ('2026-06-30', 'Lunge',             1, 12, 10),            ('2026-06-30', 'Lunge',             2, 12, 10),
  ('2026-06-30', 'Lunge',             3, 12, 10),
  ('2026-06-30', 'Calf Raise',        1, 20, 10),            ('2026-06-30', 'Calf Raise',        2, 20, 10),
  ('2026-06-30', 'Calf Raise',        3, 20, 10),            ('2026-06-30', 'Calf Raise',        4, 20, 10),
  -- Day 3 (2026-07-01): Chin-up 7x4, DB Shoulder 12/12/11/10 @15, Curl 12x3 @17.5,
  --                     Tricep Dip 12x3 +10, Lat Raise 12x4 @12.5, HLR 13/12/12
  ('2026-07-01', 'Chin-up',           1, 7,  null),          ('2026-07-01', 'Chin-up',           2, 7,  null),
  ('2026-07-01', 'Chin-up',           3, 7,  null),          ('2026-07-01', 'Chin-up',           4, 7,  null),
  ('2026-07-01', 'DB Shoulder Press', 1, 12, 15),            ('2026-07-01', 'DB Shoulder Press', 2, 12, 15),
  ('2026-07-01', 'DB Shoulder Press', 3, 11, 15),            ('2026-07-01', 'DB Shoulder Press', 4, 10, 15),
  ('2026-07-01', 'Barbell Curl',      1, 12, 17.5),          ('2026-07-01', 'Barbell Curl',      2, 12, 17.5),
  ('2026-07-01', 'Barbell Curl',      3, 12, 17.5),
  ('2026-07-01', 'Tricep Dip',        1, 12, 10),            ('2026-07-01', 'Tricep Dip',        2, 12, 10),
  ('2026-07-01', 'Tricep Dip',        3, 12, 10),
  ('2026-07-01', 'Lateral Raise',     1, 12, 12.5),          ('2026-07-01', 'Lateral Raise',     2, 12, 12.5),
  ('2026-07-01', 'Lateral Raise',     3, 12, 12.5),          ('2026-07-01', 'Lateral Raise',     4, 12, 12.5),
  ('2026-07-01', 'Hanging Leg Raise', 1, 13, null),          ('2026-07-01', 'Hanging Leg Raise', 2, 12, null),
  ('2026-07-01', 'Hanging Leg Raise', 3, 12, null),
  -- Day 5 (2026-07-03): Deadlift 9x4 @32.5 (target-seeded), Step-up 12x3 @10, Row 12x3 @32.5, Plank 60x3
  ('2026-07-03', 'Deadlift',          1, 9,  32.5),          ('2026-07-03', 'Deadlift',          2, 9,  32.5),
  ('2026-07-03', 'Deadlift',          3, 9,  32.5),          ('2026-07-03', 'Deadlift',          4, 9,  32.5),
  ('2026-07-03', 'Step-up',           1, 12, 10),            ('2026-07-03', 'Step-up',           2, 12, 10),
  ('2026-07-03', 'Step-up',           3, 12, 10),
  ('2026-07-03', 'Barbell Row',       1, 12, 32.5),          ('2026-07-03', 'Barbell Row',       2, 12, 32.5),
  ('2026-07-03', 'Barbell Row',       3, 12, 32.5),
  ('2026-07-03', 'Plank',             1, 60, null),          ('2026-07-03', 'Plank',             2, 60, null),
  ('2026-07-03', 'Plank',             3, 60, null)
) as v(session_date, ex_name, set_n, reps, weight)
join workout_sessions ws on ws.date = v.session_date::date
join exercises e         on lower(e.name) = lower(v.ex_name);

-- ---------- equipment ----------
-- Home has no bench (owner, 2026-07-06). Gym branch profiles are added when the
-- owner enumerates a location's equipment (feature brief, Risk #3).
insert into equipment_profiles (name, items, is_active) values
  ('Home', array['barbell','dumbbells','pull-up bar','plates'], true);

commit;

-- ---------- one-time spike verification (Conventions for AI #8 — run once, then delete) ----------
-- Expected vs the 2026-07-05 spike: dupes >= 0.60, elevated<->regular ≈ 0.32
-- select similarity('elevated pushup', 'elevated push-up');   -- ≈ 0.74
-- select similarity('elevated push-up', 'regular push-up');   -- ≈ 0.32
-- select similarity('benchpress', 'bench press');             -- ≈ 0.64
-- select * from search_exercises('RDL');                      -- alias hit, similarity 1.0
