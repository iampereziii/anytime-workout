-- Verification for migration 0008 — run in the Supabase SQL editor AFTER applying it.
-- Writes nothing: every log_workout / create_exercise call below is EXPECTED to raise.
-- Each query should return zero rows (or 'ok').

-- 1. app_today() is the owner's day, not UTC's. Eyeball: should match your phone's date.
select app_today() as owner_today, (now() at time zone 'utc')::date as utc_today;

-- 2. normalize_exercise_name matches the TypeScript normalizer on every shared case.
--    The JSON between the markers MUST equal tests/fixtures/exercise-name-cases.json
--    (tests/db-drift.test.ts enforces it). Expect ZERO rows.
select c->>'input' as input, c->>'expected' as expected, normalize_exercise_name(c->>'input') as got
from jsonb_array_elements(
  -- cases:start
  '[
  { "input": "benchPress", "expected": "Bench Press" },
  { "input": "BenchPress", "expected": "Bench Press" },
  { "input": "BENCH  press", "expected": "Bench Press" },
  { "input": "  bench press  ", "expected": "Bench Press" },
  { "input": "Diamond- Push-up", "expected": "Diamond Push-up" },
  { "input": "diamond push-up", "expected": "Diamond Push-up" },
  { "input": "push-UP", "expected": "Push-up" },
  { "input": "chin-up", "expected": "Chin-up" },
  { "input": "-lunge", "expected": "Lunge" },
  { "input": "db shoulder press", "expected": "DB Shoulder Press" },
  { "input": "rdl", "expected": "RDL" },
  { "input": "ohp", "expected": "OHP" },
  { "input": "bw dips", "expected": "BW Dips" },
  { "input": "ATG split squat", "expected": "ATG Split Squat" },
  { "input": "Walk / Mobility", "expected": "Walk / Mobility" },
  { "input": "Barbell Row", "expected": "Barbell Row" },
  { "input": "Incline Push-up", "expected": "Incline Push-up" },
  { "input": "Hanging Leg Raise", "expected": "Hanging Leg Raise" },
  { "input": "kettlebellHalo", "expected": "Kettlebell Halo" }
]'::jsonb
  -- cases:end
) c
where normalize_exercise_name(c->>'input') is distinct from c->>'expected';

-- 3. Guards raise (and therefore write nothing). Expect a single 'ok'.
do $$
declare
  any_ex uuid := (select id from exercises limit 1);
  sets   jsonb := jsonb_build_array(jsonb_build_object('exercise_id', any_ex, 'set_number', 1, 'reps', 8, 'weight', 100));
  before_sessions bigint := (select count(*) from workout_sessions);
  raised boolean;
begin
  -- 3a. date 8 days ago → date_out_of_window (AC #1)
  raised := false;
  begin perform log_workout(app_today() - 8, sets);
  exception when others then raised := sqlerrm like 'date_out_of_window%'; end;
  if not raised then raise exception 'FAIL 3a: 8-days-ago date was not rejected'; end if;

  -- 3b. tomorrow → date_out_of_window
  raised := false;
  begin perform log_workout(app_today() + 1, sets);
  exception when others then raised := sqlerrm like 'date_out_of_window%'; end;
  if not raised then raise exception 'FAIL 3b: future date was not rejected'; end if;

  -- 3c. one good set + one unknown exercise → nothing written (AC #2)
  raised := false;
  begin perform log_workout(app_today(), sets || jsonb_build_array(jsonb_build_object(
          'exercise_id', gen_random_uuid(), 'set_number', 1, 'reps', 5, 'weight', null)));
  exception when others then raised := sqlerrm like 'unknown_exercise%'; end;
  if not raised then raise exception 'FAIL 3c: unknown exercise was not rejected'; end if;

  -- 3d. fractional reps → rejected
  raised := false;
  begin perform log_workout(app_today(), jsonb_build_array(jsonb_build_object(
          'exercise_id', any_ex, 'set_number', 1, 'reps', 8.5, 'weight', null)));
  exception when others then raised := true; end;
  if not raised then raise exception 'FAIL 3d: fractional reps were accepted'; end if;

  -- 3e. unknown muscle group → rejected (brief Risk #7)
  raised := false;
  begin perform create_exercise('zz verify only', false, 'reps', array['shoulder_front']);
  exception when others then raised := sqlerrm like 'bad_request: unknown muscle group%'; end;
  if not raised then raise exception 'FAIL 3e: unknown muscle group was accepted'; end if;

  if (select count(*) from workout_sessions) <> before_sessions then
    raise exception 'FAIL: a rejected call left a session behind';
  end if;
  raise notice 'ok';
end;
$$;
select 'ok' as result;
