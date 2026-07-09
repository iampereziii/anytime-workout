-- Any Time Workout — migration 0007: retire the stored program (DROP — ONE-WAY)
-- Decision: ADR-0007 (AI generates the daily recommendation; retire the stored program).
--   c:/local-instance/ais/projects/any-time-workout/decisions/adr-0007-ai-generates-daily-recommendation-retire-stored-program.md
--
-- Supersedes ADR-0001 (in part — retires the program entity it introduced),
-- ADR-0005 (fully), and amends ADR-0004 (the fact/composition boundary moves:
-- the model now originates lifts/sets/weight; progression targets and the
-- recovery-readiness gate STAY deterministic — they run off retained data
-- (pr_bests + exercises; session-derived muscle recency over PARENT_GROUPS),
-- neither needs the tables dropped here).
--
-- ⚠ ONE-WAY. Run 0006 and verify its check query returns ZERO rows FIRST.
-- The 6-day prescription survives only in git history after this.
--
-- What survives untouched (ADR data-safety guarantee — byte-identical):
--   workout_sessions, logged_sets, the pr_bests view, exercises, equipment_profiles.
--
-- Apply-once, safe to re-run: paste this body into the Supabase SQL editor once.
-- Fresh-reset ordering (migrations before seed): on an empty DB the program tables
-- exist but are empty; dropping them is still correct, and the NEW seed.sql no
-- longer references them.

begin;

-- ---------- 1. drop the stored program entity (ADR-0001 tables) ----------
-- CASCADE clears the FK chain (planned_exercises → program_days → programs) and
-- any dependents; none of the retained log/PR objects reference these.
drop table if exists planned_exercises cascade;
drop table if exists program_days      cascade;
drop table if exists programs          cascade;

-- ---------- 2. retire recommendation modes (ADR-0007: modes are retired) ----------
-- app_settings only ever held recommendation_mode (migration 0005). With modes
-- gone there is no setting left to store, so the whole singleton is dropped.
drop table if exists app_settings cascade;

-- ---------- 3. re-shape the recommendation cache → pinned-per-day target ----------
-- Finding 4 (must-fix): remainingToday now re-derives against the day's
-- recommendation, so "N left" must not shift mid-workout. The recommendation is
-- pinned IMMUTABLY per calendar day: composed once (first load of the day),
-- reused for every later load that day; new logs subtract against the fixed
-- target instead of triggering a recompose. The old per-session fingerprint
-- (which changed on every log) is therefore replaced by a rec_date unique key.
--
-- daily_recommendations is a disposable cache (no historical value) → truncate,
-- then swap the key from fingerprint to rec_date and record the prompt version
-- for auditability.
truncate table daily_recommendations;

alter table daily_recommendations drop constraint if exists daily_recommendations_fingerprint_key;
alter table daily_recommendations drop column     if exists fingerprint;
alter table daily_recommendations add  column     if not exists prompt_version int;

-- One pinned recommendation per calendar day; the route inserts if-absent on this.
create unique index if not exists daily_recommendations_rec_date_key on daily_recommendations (rec_date);

commit;
