-- Any Time Workout — initial schema
-- Decisions: ADR-0001 (structured program), ADR-0003 (pg_trgm dedup, threshold 0.5),
-- sibling Decision 3 (PRs derived, never stored). See ais repo for ADRs.

create extension if not exists pg_trgm;
create extension if not exists pgcrypto; -- gen_random_uuid

-- ---------- exercises ----------
create type exercise_unit as enum ('reps', 'seconds', 'minutes');

create table exercises (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  aliases       text[] not null default '{}',
  is_bodyweight boolean not null default false,
  unit          exercise_unit not null default 'reps',
  created_at    timestamptz not null default now()
);
create unique index exercises_name_ci on exercises (lower(name));
-- The dedup/search index (ADR-0003): GIN trigram on name.
create index exercises_name_trgm on exercises using gin (name gin_trgm_ops);

-- ---------- program ----------
create table programs (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  is_active boolean not null default false
);

create table program_days (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  day_number int  not null check (day_number between 1 and 7),
  label      text not null,
  notes      text,
  unique (program_id, day_number)
);

create table planned_exercises (
  id             uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references program_days(id) on delete cascade,
  exercise_id    uuid not null references exercises(id),
  target_sets    int  not null check (target_sets > 0),
  target_reps    int,              -- NULL = AMRAP ("max reps"); value in exercises.unit
  target_weight  numeric(6,2),     -- bodyweight exercises: ADDED lbs; NULL = pure BW / n-a
  rest_seconds   int,
  notes          text,             -- tempo cues
  sort_order     int not null default 0
);

-- ---------- logging ----------
create type session_part as enum ('am', 'pm');

create table workout_sessions (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  part       session_part,         -- NULL = single session
  notes      text,
  created_at timestamptz not null default now()
);

create table logged_sets (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references workout_sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  set_number  int  not null check (set_number > 0),
  reps        int  not null check (reps >= 0),  -- value in exercises.unit
  weight      numeric(6,2),                      -- bodyweight: ADDED lbs
  logged_at   timestamptz not null default now()
);
create index logged_sets_exercise on logged_sets (exercise_id);
create index workout_sessions_date on workout_sessions (date desc);

-- ---------- equipment ----------
create table equipment_profiles (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  items     text[] not null default '{}',
  is_active boolean not null default false
);

-- ---------- derived PRs (Decision 3: view, never a table) ----------
-- Q3 definition: bodyweight → best reps-in-a-set (ties broken by added weight);
--                weighted   → best weight (ties broken by reps). Per variation.
create view pr_bests as
select distinct on (e.id)
  e.id   as exercise_id,
  e.name as exercise_name,
  e.is_bodyweight,
  e.unit,
  ls.reps   as best_reps,
  ls.weight as best_weight,
  ws.date   as achieved_on
from logged_sets ls
join exercises e        on e.id = ls.exercise_id
join workout_sessions ws on ws.id = ls.session_id
order by
  e.id,
  case when e.is_bodyweight then ls.reps   else coalesce(ls.weight, 0) end desc,
  case when e.is_bodyweight then coalesce(ls.weight, 0) else ls.reps  end desc,
  ws.date desc;

-- ---------- search RPC (ADR-0003: trigram + exact alias match, threshold 0.5) ----------
-- Returns candidates for the combobox and the "did you mean?" dedup check.
-- Alias hits rank first (similarity 1.0) — trigram can't see abbreviations
-- (spike: RDL <-> romanian deadlift = 0.048).
create or replace function search_exercises(q text)
returns table (id uuid, name text, similarity real, matched_alias boolean)
language sql stable as $$
  select e.id, e.name,
         greatest(similarity(e.name, q),
                  case when lower(q) = any (select lower(a) from unnest(e.aliases) a) then 1.0 else 0 end)::real
           as similarity,
         (lower(q) = any (select lower(a) from unnest(e.aliases) a)) as matched_alias
  from exercises e
  where similarity(e.name, q) > 0.15  -- broad candidate net for the combobox; the 0.5
                                      -- did-you-mean threshold is applied in app code
     or lower(q) = any (select lower(a) from unnest(e.aliases) a)
  order by similarity desc, e.name
  limit 10;
$$;
