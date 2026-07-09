-- Any Time Workout — migration 0006: flatten program defaults onto exercises (PRESERVE)
-- Decision: ADR-0007 (AI generates the daily recommendation; retire the stored program).
--   c:/local-instance/ais/projects/any-time-workout/decisions/adr-0007-ai-generates-daily-recommendation-retire-stored-program.md
--
-- This is the PRESERVE half of the two-step retirement. It MUST run and be
-- verified non-empty BEFORE the one-way drop in 0007 (ADR Consequences: the
-- preserve-migration runs and is verified before the drop; both are apply-once
-- and irreversible).
--
-- rest_seconds + tempo cues are the ONLY plan-exclusive data. We move them to
-- per-exercise defaults on `exercises` so the recommendation composer can still
-- cite a sensible rest/cue after `planned_exercises` is gone. Per-day fidelity
-- is intentionally FLATTENED to one default per exercise (ADR finding 6 —
-- acceptable for a solo user, acknowledged here, not silent).
--
-- Flatten rule: take the value from the exercise's FIRST planned appearance,
-- ordered by (program_days.day_number, planned_exercises.sort_order). `distinct
-- on` picks that first row deterministically.
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once.
-- Fresh-reset ordering (migrations before seed): on an empty DB `planned_exercises`
-- has no rows yet, so the backfill below no-ops and the NEW seed.sql lands the
-- flattened defaults directly on the exercise inserts. On the live (already-seeded)
-- DB, seed is not re-run, so THIS file does the backfill from the real plan.

begin;

alter table exercises add column if not exists default_rest_seconds int;
alter table exercises add column if not exists default_cue          text;

update exercises e
set default_rest_seconds = f.rest_seconds,
    default_cue          = f.notes
from (
  select distinct on (pe.exercise_id)
    pe.exercise_id,
    pe.rest_seconds,
    pe.notes
  from planned_exercises pe
  join program_days pd on pd.id = pe.program_day_id
  order by pe.exercise_id, pd.day_number, pe.sort_order
) f
where e.id = f.exercise_id;

commit;

-- ---------- post-migration verification (run once BEFORE applying 0007, then delete) ----------
-- Expect ZERO rows on the live DB: every exercise that has ANY planned row must
-- now carry a default rest. A row returned means the backfill missed it — STOP and
-- investigate before dropping the plan tables (the drop is one-way).
-- select e.name
-- from exercises e
-- where exists (select 1 from planned_exercises pe where pe.exercise_id = e.id)
--   and e.default_rest_seconds is null;
