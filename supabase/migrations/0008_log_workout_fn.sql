-- Any Time Workout — migration 0008: guarded DB functions for the chat logging door
-- Decision: ADR-0012 (add a chat logging door via guarded DB functions).
--   c:/local-instance/ais/projects/any-time-workout/decisions/adr-0012-chat-logging-door-via-guarded-db-functions.md
-- Feature brief: feature-brief-agentic-logging-claude-project.md (same folder's parent).
--
-- WHY: a claude.ai Project logs workouts through the Supabase connector, which
-- talks to Postgres directly and skips every guard in POST /api/log. The guards
-- that CAN be structural live here instead; Claude is instructed to write ONLY
-- through log_workout() / create_exercise() (docs/claude-project-instructions.md).
--
-- ⚠ DUPLICATED RULES — keep in sync with the TypeScript originals:
--   app_today() window       ↔ src/lib/dates.ts (isWithinBackdateWindow, APP_TIMEZONE)
--   log_workout() limits     ↔ src/lib/validators (LogRequestSchema, LoggedSetInputSchema)
--   normalize_exercise_name  ↔ src/lib/exercises/normalize.ts   (drift test: tests/db-drift.test.ts)
--   muscle_group_vocabulary  ↔ src/lib/muscle-groups.ts         (drift test: tests/db-drift.test.ts)
--   app_settings.timezone    ↔ APP_TIMEZONE env var — change BOTH if you move.
--
-- All functions are SECURITY INVOKER (default): the connector already runs with
-- full rights, so nothing here needs elevation. search_path is pinned anyway
-- (Supabase advisor: function_search_path_mutable).
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once,
-- then run supabase/verify/0008_checks.sql.

begin;

-- ---------- 1. owner's timezone, in the DB (brief Risk #1) ----------
-- 0007 dropped app_settings (its only column, recommendation_mode, was retired),
-- so the singleton comes back here holding just the timezone. Same shape and
-- RLS stance as 0005: enforced single row (id = 1), deny-all for anon/authenticated.
create table if not exists app_settings (
  id         smallint primary key default 1 check (id = 1),
  timezone   text not null,
  updated_at timestamptz not null default now()
);
insert into app_settings (id, timezone) values (1, 'Asia/Manila')
  on conflict (id) do nothing;
alter table app_settings enable row level security;

-- The owner's calendar day — the DB twin of appTodayIso(). Fail-fast like
-- appTimeZone(): no silent fallback to the server clock (UTC).
create or replace function app_today()
returns date
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  tz text;
begin
  select s.timezone into tz from app_settings s where s.id = 1;
  if tz is null then
    raise exception 'app_settings.timezone is not set — refusing to derive today from the server clock (UTC)';
  end if;
  return (now() at time zone tz)::date;
end;
$$;

-- ---------- 2. muscle-group vocabulary (brief Risk #7) ----------
-- Order and content MUST equal MUSCLE_GROUP_VOCABULARY. tests/db-drift.test.ts
-- parses the array between the vocab markers and fails on any difference.
create or replace function muscle_group_vocabulary()
returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array[
    -- vocab:start
    'chest', 'back', 'shoulders', 'biceps', 'triceps', 'core', 'quads', 'hamstrings', 'glutes', 'calves',
    'chest_upper', 'chest_mid', 'chest_lower',
    'back_lats', 'back_upper', 'back_lower',
    'shoulders_front', 'shoulders_side', 'shoulders_rear',
    'biceps_long', 'biceps_short',
    'triceps_long', 'triceps_lateral', 'triceps_medial',
    'core_upper', 'core_lower', 'core_obliques',
    'glutes_max', 'glutes_med',
    'calves_gastroc', 'calves_soleus'
    -- vocab:end
  ]::text[];
$$;

-- ---------- 3. exercise-name normalization (port of normalizeExerciseName) ----------
-- Rule: split camel/PascalCase → strip dangling/leading hyphens → collapse
-- whitespace → Title Case → DB/BW/RDL/OHP always caps; user-typed ≤3-char
-- all-caps standalone tokens kept; hyphen compounds "Push-up" not "Push-Up".
create or replace function normalize_exercise_name(raw text)
returns text
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  s        text;
  word     text;
  part     text;
  up       text;
  lo       text;
  i        int;
  parts    text[];
  out_word text;
  words    text[] := '{}';
begin
  if raw is null then
    return null;
  end if;
  s := regexp_replace(raw, '([a-z0-9])([A-Z])', '\1 \2', 'g');
  s := regexp_replace(s, '-+(\s|$)', '\1', 'g');
  s := regexp_replace(s, '(^|\s)-+', '\1', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  if s = '' then
    return '';
  end if;

  foreach word in array string_to_array(s, ' ') loop
    parts := string_to_array(word, '-');
    out_word := '';
    for i in 1 .. coalesce(array_length(parts, 1), 0) loop
      part := parts[i];
      up := upper(part);
      lo := lower(part);
      if part = '' then
        null;                                            -- keep empty sub-part
      elsif up in ('DB', 'BW', 'RDL', 'OHP') then
        part := up;
      elsif i = 1 and length(part) <= 3 and part = up and part ~ '[A-Z]' then
        null;                                            -- user-typed short caps
      elsif i = 1 then
        part := upper(left(lo, 1)) || substr(lo, 2);
      else
        part := lo;
      end if;
      out_word := out_word || case when i > 1 then '-' else '' end || part;
    end loop;
    words := words || out_word;
  end loop;

  return array_to_string(words, ' ');
end;
$$;

-- ---------- 4. create_exercise — guarded creator (brief Risk #2) ----------
-- Mirrors POST /api/exercises + ExerciseCreateSchema. Claude calls this ONLY
-- after the owner rejected every did-you-mean (search_exercises ≥ 0.5) and
-- confirmed name / is_bodyweight / unit / tags. The unique lower(name) index
-- (0001) stays the final duplicate backstop.
create or replace function create_exercise(
  p_name          text,
  p_is_bodyweight boolean       default false,
  p_unit          exercise_unit default 'reps',
  p_muscle_groups text[]        default '{}',
  p_aliases       text[]        default '{}'
)
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_name    text;
  v_groups  text[];
  v_aliases text[];
  v_bad     text[];
  v_row     exercises;
begin
  if p_name is null or length(btrim(p_name)) = 0 or length(btrim(p_name)) > 80 then
    raise exception 'bad_request: name must be 1–80 characters';
  end if;
  v_name := normalize_exercise_name(btrim(p_name));
  if v_name = '' then
    raise exception 'bad_request: name is empty after normalization';
  end if;

  -- aliases: trimmed, 1–40 chars each, at most 10
  select coalesce(array_agg(btrim(a)), '{}') into v_aliases
    from unnest(coalesce(p_aliases, '{}')) a;
  if cardinality(v_aliases) > 10 then
    raise exception 'bad_request: at most 10 aliases';
  end if;
  if exists (select 1 from unnest(v_aliases) a where length(a) = 0 or length(a) > 40) then
    raise exception 'bad_request: each alias must be 1–40 characters';
  end if;

  -- muscle groups: de-duplicated (first occurrence wins), vocabulary-only, at most 12
  select coalesce(array_agg(g order by ord), '{}') into v_groups
    from (
      select g, min(ord) as ord
      from unnest(coalesce(p_muscle_groups, '{}')) with ordinality as t(g, ord)
      group by g
    ) d;
  select array_agg(g) into v_bad
    from unnest(v_groups) g
    where not (g = any (muscle_group_vocabulary()));
  if v_bad is not null then
    raise exception 'bad_request: unknown muscle group(s): % — allowed: %',
      array_to_string(v_bad, ', '), array_to_string(muscle_group_vocabulary(), ', ');
  end if;
  if cardinality(v_groups) > 12 then
    raise exception 'bad_request: at most 12 muscle groups';
  end if;

  begin
    insert into exercises (name, aliases, is_bodyweight, unit, muscle_groups)
    values (v_name, v_aliases, coalesce(p_is_bodyweight, false), coalesce(p_unit, 'reps'), v_groups)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'duplicate_name: an exercise named "%" already exists', v_name;
  end;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'is_bodyweight', v_row.is_bodyweight,
    'unit', v_row.unit,
    'muscle_groups', to_jsonb(v_row.muscle_groups),
    'aliases', to_jsonb(v_row.aliases)
  );
end;
$$;

-- ---------- 5. log_workout — guarded, atomic logger (brief scope) ----------
-- Mirrors POST /api/log + LogRequestSchema. One function call = one statement,
-- so ANY raise rolls back the session AND its sets — a real transaction, no
-- orphan sessions (stronger than the route's delete-on-failure workaround).
--
-- p_sets: jsonb array of {exercise_id, set_number, reps, weight}; weight may be
-- null; reps is the value in the exercise's unit; weight is ADDED lbs for
-- bodyweight movements.
create or replace function log_workout(
  p_date  date,
  p_sets  jsonb,
  p_part  session_part default null,
  p_notes text         default null
)
returns jsonb
language plpgsql volatile
set search_path = public, pg_temp
as $$
declare
  v_today      date := app_today();
  v_session_id uuid;
  v_count      int;
  v_missing    text[];
begin
  -- backdate window [today − 7, today] in the owner's zone (isWithinBackdateWindow)
  if p_date is null or p_date < v_today - 7 or p_date > v_today then
    raise exception 'date_out_of_window: date % is outside the allowed window [%, %]',
      p_date, v_today - 7, v_today;
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'bad_request: notes must be at most 500 characters';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' then
    raise exception 'bad_request: sets must be a JSON array';
  end if;
  v_count := jsonb_array_length(p_sets);
  if v_count < 1 or v_count > 200 then
    raise exception 'bad_request: sets must contain 1–200 rows (got %)', v_count;
  end if;

  -- per-set shape (casts raise on non-integers / bad uuids — that's the point)
  if exists (
    select 1
    from jsonb_to_recordset(p_sets) as s(exercise_id uuid, set_number int, reps int, weight numeric)
    where s.exercise_id is null
       or s.set_number is null or s.set_number < 1
       or s.reps is null or s.reps < 0 or s.reps > 10000
       or (s.weight is not null and (s.weight < 0 or s.weight > 10000))
  ) then
    raise exception 'bad_request: every set needs exercise_id, set_number ≥ 1, reps 0–10000, weight null or 0–10000';
  end if;

  select array_agg(distinct s.exercise_id::text) into v_missing
    from jsonb_to_recordset(p_sets) as s(exercise_id uuid)
    where not exists (select 1 from exercises e where e.id = s.exercise_id);
  if v_missing is not null then
    raise exception 'unknown_exercise: no exercise with id(s) %', array_to_string(v_missing, ', ');
  end if;

  insert into workout_sessions (date, part, notes)
  values (p_date, p_part, p_notes)
  returning id into v_session_id;

  insert into logged_sets (session_id, exercise_id, set_number, reps, weight)
  select v_session_id, s.exercise_id, s.set_number, s.reps, s.weight
  from jsonb_to_recordset(p_sets) as s(exercise_id uuid, set_number int, reps int, weight numeric);

  return jsonb_build_object('session_id', v_session_id, 'date', p_date, 'set_count', v_count);
end;
$$;

-- Defense-in-depth, matching the 0001 RLS stance (anon/authenticated get nothing):
-- these are owner/service-role tools, never client RPCs.
revoke execute on function app_today()                                               from public, anon, authenticated;
revoke execute on function muscle_group_vocabulary()                                 from public, anon, authenticated;
revoke execute on function normalize_exercise_name(text)                             from public, anon, authenticated;
revoke execute on function create_exercise(text, boolean, exercise_unit, text[], text[]) from public, anon, authenticated;
revoke execute on function log_workout(date, jsonb, session_part, text)              from public, anon, authenticated;
-- Explicit, so the app's server client could adopt these later (brief Risk #6).
grant execute on function app_today(), muscle_group_vocabulary(), normalize_exercise_name(text),
  create_exercise(text, boolean, exercise_unit, text[], text[]),
  log_workout(date, jsonb, session_part, text) to service_role;

commit;
