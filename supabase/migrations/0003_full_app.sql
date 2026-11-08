-- Full v1 app: Strava cleanup, weight-unit setting, and the RPCs used by the
-- week planner, lift logger, run logger, routines and conflict rules.
--
-- Written against the LIVE schema (see supabase/tests/live_schema.sql), which
-- has drifted from 0001. Safe to re-run: every step is guarded or uses
-- create-or-replace.
--
-- All functions are security invoker: they run as the calling user, so RLS
-- still applies. Because foreign keys bypass RLS, functions explicitly check
-- that referenced rows (sessions, routines, exercises) are visible to the
-- caller before using them.
--
-- Lift weights are stored in lb; the app converts for users who prefer kg.

-- ---------------------------------------------------------------------------
-- 1. Strava cleanup
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'run_details' and column_name = 'strava_name'
  ) then
    -- Keep any Strava activity names by moving them into notes.
    update run_details
    set notes = case
      when notes is null or btrim(notes) = '' then btrim(strava_name)
      else btrim(strava_name) || E'\n' || notes
    end
    where strava_name is not null and btrim(strava_name) <> '';

    alter table run_details drop column strava_name;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'oauth_provider' and e.enumlabel = 'strava'
  ) then
    delete from oauth_connections where provider = 'strava';
    alter type oauth_provider rename to oauth_provider_old;
    create type oauth_provider as enum ('google');
    alter table oauth_connections
      alter column provider type oauth_provider using provider::text::oauth_provider;
    drop type oauth_provider_old;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Settings
-- ---------------------------------------------------------------------------

alter table user_settings
  add column if not exists weight_unit text not null default 'lb'
    constraint user_settings_weight_unit_check check (weight_unit in ('kg', 'lb'));

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Returns the caller's plan for the ISO week (Monday start) containing p_date,
-- creating it if needed.
create or replace function ensure_plan(p_date date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_plan_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_date is null then
    raise exception 'Date is required';
  end if;

  insert into plans (user_id, week_start_date)
  values (v_user_id, p_date - (extract(isodow from p_date)::integer - 1))
  on conflict (user_id, week_start_date) do update
    set week_start_date = excluded.week_start_date
  returning id into v_plan_id;

  return v_plan_id;
end;
$$;

-- Validates optional run actuals shared by log_run and complete_run.
create or replace function assert_run_actuals(
  p_distance_km numeric,
  p_duration_sec integer,
  p_avg_hr numeric,
  p_elevation_m numeric
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_distance_km is null or p_distance_km <= 0 or p_distance_km > 1000 then
    raise exception 'Distance must be between 0 and 1000 km';
  end if;
  if p_duration_sec is null or p_duration_sec <= 0 or p_duration_sec > 7 * 24 * 3600 then
    raise exception 'Duration must be greater than 0';
  end if;
  if p_avg_hr is not null and (p_avg_hr < 20 or p_avg_hr > 250) then
    raise exception 'Average HR must be between 20 and 250';
  end if;
  if p_elevation_m is not null and (p_elevation_m < 0 or p_elevation_m > 20000) then
    raise exception 'Elevation gain must be between 0 and 20000 m';
  end if;
end;
$$;

-- Recomputes personal_records for the caller's given exercises from scratch,
-- walking completed sessions in date order. A session's best is a PR when it
-- beats every earlier session (the first session for an exercise is the
-- baseline PR). Only working and failure sets with reps > 0 count.
create or replace function rebuild_prs(p_exercise_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_exercise_ids is null or cardinality(p_exercise_ids) = 0 then
    return;
  end if;

  delete from personal_records
  where user_id = v_user_id and exercise_id = any (p_exercise_ids);

  with sets as (
    select
      ls.exercise_id,
      s.id as session_id,
      s.planned_date,
      s.created_at,
      ls.reps,
      coalesce(ls.weight, 0) as weight
    from lift_sets ls
    join sessions s on s.id = ls.lift_details_id
    join plans p on p.id = s.plan_id
    where p.user_id = v_user_id
      and s.status = 'completed'
      and ls.exercise_id = any (p_exercise_ids)
      and ls.set_type in ('working', 'failure')
      and ls.reps > 0
  ),
  -- One candidate per (session, exercise, record type): the session's best.
  candidates as (
    (select distinct on (exercise_id, session_id)
      exercise_id, session_id, planned_date, created_at,
      'heaviest_weight'::pr_record_type as record_type,
      weight as value, weight, reps
    from sets where weight > 0
    order by exercise_id, session_id, weight desc, reps desc)

    union all

    (select distinct on (exercise_id, session_id)
      exercise_id, session_id, planned_date, created_at,
      'best_e1rm'::pr_record_type as record_type,
      round(weight * (1 + reps / 30.0), 1) as value, weight, reps
    from sets where weight > 0 and reps <= 12
    order by exercise_id, session_id, weight * (1 + reps / 30.0) desc, weight desc)

    union all

    (select distinct on (exercise_id, session_id)
      exercise_id, session_id, planned_date, created_at,
      'most_reps'::pr_record_type as record_type,
      reps::numeric as value, weight, reps
    from sets
    order by exercise_id, session_id, reps desc, weight desc)

    union all

    select
      exercise_id, session_id, min(planned_date) as planned_date, min(created_at) as created_at,
      'best_volume'::pr_record_type as record_type,
      sum(weight * reps) as value, null::numeric as weight, null::integer as reps
    from sets where weight > 0
    group by exercise_id, session_id
  ),
  ranked as (
    select c.*,
      max(value) over (
        partition by exercise_id, record_type
        order by planned_date, created_at, session_id
        rows between unbounded preceding and 1 preceding
      ) as prev_best
    from candidates c
  )
  insert into personal_records (user_id, exercise_id, record_type, value, weight, reps, session_id, achieved_at)
  select v_user_id, exercise_id, record_type, value, weight, reps, session_id,
    (planned_date + time '12:00') at time zone 'UTC'
  from ranked
  where value > coalesce(prev_best, 0);
end;
$$;

-- Exercise ids used by a lift session (empty for runs).
create or replace function session_exercise_ids(p_session_id uuid)
returns uuid[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(array_agg(distinct exercise_id), '{}')
  from lift_sets where lift_details_id = p_session_id
$$;

-- ---------------------------------------------------------------------------
-- 4. Runs
-- ---------------------------------------------------------------------------

-- Logs an unplanned, completed run (same signature as 0002; now marks ad_hoc).
create or replace function log_run(
  p_date date,
  p_run_type run_type,
  p_distance_km numeric,
  p_duration_sec integer,
  p_avg_hr integer default null,
  p_elevation_gain_m numeric default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_session_id uuid;
begin
  if p_run_type is null then
    raise exception 'Run type is required';
  end if;
  perform assert_run_actuals(p_distance_km, p_duration_sec, p_avg_hr, p_elevation_gain_m);

  -- Resolve the plan in its own statement: RLS on sessions checks the plan
  -- row, which a function called inside the same INSERT would create too late
  -- for that statement's snapshot to see.
  v_plan_id := ensure_plan(p_date);
  insert into sessions (plan_id, type, planned_date, status, ad_hoc)
  values (v_plan_id, 'run', p_date, 'completed', true)
  returning id into v_session_id;

  insert into run_details (
    session_id, run_type,
    actual_distance_km, actual_duration_sec, actual_pace_sec_per_km,
    actual_avg_hr, actual_elevation_m, notes
  )
  values (
    v_session_id, p_run_type,
    p_distance_km, p_duration_sec, round(p_duration_sec / p_distance_km)::integer,
    p_avg_hr, p_elevation_gain_m, nullif(btrim(p_notes), '')
  );

  return v_session_id;
end;
$$;

-- Plans a future run. Targets are optional; pace is derived from distance and
-- duration when not given, and planned_duration_min from target duration.
create or replace function plan_run(
  p_date date,
  p_run_type run_type,
  p_start_time time default null,
  p_duration_min integer default null,
  p_target_distance_km numeric default null,
  p_target_duration_sec integer default null,
  p_target_pace_sec_per_km integer default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_session_id uuid;
  v_pace integer := p_target_pace_sec_per_km;
begin
  if p_run_type is null then
    raise exception 'Run type is required';
  end if;
  if p_duration_min is not null and (p_duration_min <= 0 or p_duration_min > 24 * 60) then
    raise exception 'Planned duration must be between 1 and 1440 minutes';
  end if;
  if p_target_distance_km is not null and (p_target_distance_km <= 0 or p_target_distance_km > 1000) then
    raise exception 'Target distance must be between 0 and 1000 km';
  end if;
  if p_target_duration_sec is not null and p_target_duration_sec <= 0 then
    raise exception 'Target duration must be greater than 0';
  end if;
  if v_pace is not null and v_pace <= 0 then
    raise exception 'Target pace must be greater than 0';
  end if;
  if v_pace is null and p_target_distance_km is not null and p_target_duration_sec is not null then
    v_pace := round(p_target_duration_sec / p_target_distance_km)::integer;
  end if;

  v_plan_id := ensure_plan(p_date);
  insert into sessions (plan_id, type, planned_date, status, planned_start_time, planned_duration_min)
  values (
    v_plan_id, 'run', p_date, 'planned', p_start_time,
    coalesce(p_duration_min, ceil(p_target_duration_sec / 60.0)::integer)
  )
  returning id into v_session_id;

  insert into run_details (session_id, run_type, target_distance_km, target_duration_sec, target_pace_sec_per_km)
  values (v_session_id, p_run_type, p_target_distance_km, p_target_duration_sec, v_pace);

  return v_session_id;
end;
$$;

-- Records actuals on an existing run session (planned or already completed)
-- and marks it completed.
create or replace function complete_run(
  p_session_id uuid,
  p_distance_km numeric,
  p_duration_sec integer,
  p_avg_hr integer default null,
  p_elevation_m numeric default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from sessions where id = p_session_id and type = 'run') then
    raise exception 'Run not found';
  end if;
  perform assert_run_actuals(p_distance_km, p_duration_sec, p_avg_hr, p_elevation_m);

  update run_details set
    actual_distance_km = p_distance_km,
    actual_duration_sec = p_duration_sec,
    actual_pace_sec_per_km = round(p_duration_sec / p_distance_km)::integer,
    actual_avg_hr = p_avg_hr,
    actual_elevation_m = p_elevation_m,
    notes = nullif(btrim(p_notes), '')
  where session_id = p_session_id;
  if not found then
    raise exception 'Run details missing for session %', p_session_id;
  end if;

  update sessions set status = 'completed' where id = p_session_id;
  return p_session_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Lifts
-- ---------------------------------------------------------------------------

create or replace function plan_lift(
  p_date date,
  p_focus text,
  p_start_time time default null,
  p_duration_min integer default null,
  p_routine_id uuid default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_session_id uuid;
begin
  if p_focus is null or btrim(p_focus) = '' then
    raise exception 'Focus is required';
  end if;
  if p_duration_min is not null and (p_duration_min <= 0 or p_duration_min > 24 * 60) then
    raise exception 'Planned duration must be between 1 and 1440 minutes';
  end if;
  if p_routine_id is not null and not exists (select 1 from routines where id = p_routine_id) then
    raise exception 'Routine not found';
  end if;

  v_plan_id := ensure_plan(p_date);
  insert into sessions (plan_id, type, planned_date, status, planned_start_time, planned_duration_min, routine_id)
  values (v_plan_id, 'lift', p_date, 'planned', p_start_time, p_duration_min, p_routine_id)
  returning id into v_session_id;

  insert into lift_details (session_id, focus, notes)
  values (v_session_id, btrim(p_focus), nullif(btrim(p_notes), ''));

  return v_session_id;
end;
$$;

-- Logs a completed lift. With p_session_id null, creates an ad-hoc session on
-- p_date; otherwise completes (or edits) that lift session and moves it to
-- p_date. Replaces all sets with p_sets, an ordered array of
--   {"exercise_id": uuid, "set_type": "working"|"warmup"|"drop"|"failure",
--    "reps": int|null, "weight": number|null (lb), "rpe": number|null}
-- set_number counts 1.. per exercise in array order.
create or replace function log_lift(
  p_session_id uuid,
  p_date date,
  p_focus text,
  p_notes text,
  p_sets jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session_id uuid := p_session_id;
  v_plan_id uuid;
  v_old_exercises uuid[] := '{}';
  v_set jsonb;
  v_idx integer := 0;
  v_exercise_id uuid;
  v_reps numeric;
  v_weight numeric;
  v_rpe numeric;
begin
  if p_date is null then
    raise exception 'Date is required';
  end if;
  if p_focus is null or btrim(p_focus) = '' then
    raise exception 'Focus is required';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' or jsonb_array_length(p_sets) = 0 then
    raise exception 'Add at least one set';
  end if;
  if jsonb_array_length(p_sets) > 500 then
    raise exception 'Too many sets';
  end if;

  for v_set in select value from jsonb_array_elements(p_sets) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_set) <> 'object' then
      raise exception 'Set % is malformed', v_idx;
    end if;
    begin
      v_exercise_id := (v_set ->> 'exercise_id')::uuid;
      v_reps := (v_set ->> 'reps')::numeric;
      v_weight := (v_set ->> 'weight')::numeric;
      v_rpe := (v_set ->> 'rpe')::numeric;
      perform coalesce(v_set ->> 'set_type', 'working')::set_type;
    exception when others then
      raise exception 'Set % has an invalid value', v_idx;
    end;
    if v_exercise_id is null then
      raise exception 'Set % needs an exercise', v_idx;
    end if;
    if not exists (select 1 from exercises where id = v_exercise_id) then
      raise exception 'Set % uses an unknown exercise', v_idx;
    end if;
    if v_reps is not null and (v_reps <> trunc(v_reps) or v_reps < 0 or v_reps > 1000) then
      raise exception 'Set %: reps must be a whole number from 0 to 1000', v_idx;
    end if;
    if v_weight is not null and (v_weight < 0 or v_weight > 5000) then
      raise exception 'Set %: weight must be between 0 and 5000', v_idx;
    end if;
    if v_rpe is not null and (v_rpe < 1 or v_rpe > 10) then
      raise exception 'Set %: RPE must be between 1 and 10', v_idx;
    end if;
  end loop;

  if v_session_id is null then
    v_plan_id := ensure_plan(p_date);
    insert into sessions (plan_id, type, planned_date, status, ad_hoc)
    values (v_plan_id, 'lift', p_date, 'completed', true)
    returning id into v_session_id;
  else
    if not exists (select 1 from sessions where id = v_session_id and type = 'lift') then
      raise exception 'Lift not found';
    end if;
    v_old_exercises := session_exercise_ids(v_session_id);
    v_plan_id := ensure_plan(p_date);
    update sessions
    set status = 'completed', planned_date = p_date, plan_id = v_plan_id
    where id = v_session_id;
  end if;

  insert into lift_details (session_id, focus, notes, completed_at)
  values (v_session_id, btrim(p_focus), nullif(btrim(p_notes), ''), now())
  on conflict (session_id) do update set
    focus = excluded.focus,
    notes = excluded.notes,
    completed_at = coalesce(lift_details.completed_at, excluded.completed_at);

  delete from lift_sets where lift_details_id = v_session_id;

  -- created_at preserves array order (now() alone is identical for every row
  -- in the transaction, which would lose the exercise order).
  insert into lift_sets (lift_details_id, exercise_id, set_number, set_type, reps, weight, rpe, created_at)
  select
    v_session_id,
    (e.value ->> 'exercise_id')::uuid,
    row_number() over (partition by e.value ->> 'exercise_id' order by e.ordinality),
    coalesce(e.value ->> 'set_type', 'working')::set_type,
    (e.value ->> 'reps')::integer,
    (e.value ->> 'weight')::numeric,
    (e.value ->> 'rpe')::numeric,
    now() + e.ordinality * interval '1 microsecond'
  from jsonb_array_elements(p_sets) with ordinality as e(value, ordinality)
  order by e.ordinality;

  perform rebuild_prs(array(
    select unnest(v_old_exercises) union select unnest(session_exercise_ids(v_session_id))
  ));

  return v_session_id;
end;
$$;

-- Creates (p_routine_id null) or replaces a routine and its exercise list.
-- p_exercises: ordered array of {"exercise_id": uuid, "target_sets": int|null, "target_reps": int|null}
create or replace function save_routine(
  p_routine_id uuid,
  p_name text,
  p_exercises jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_routine_id uuid := p_routine_id;
  v_item jsonb;
  v_idx integer := 0;
  v_exercise_id uuid;
  v_sets numeric;
  v_reps numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Routine name is required';
  end if;
  if p_exercises is null or jsonb_typeof(p_exercises) <> 'array' or jsonb_array_length(p_exercises) = 0 then
    raise exception 'Add at least one exercise';
  end if;

  for v_item in select value from jsonb_array_elements(p_exercises) loop
    v_idx := v_idx + 1;
    begin
      v_exercise_id := (v_item ->> 'exercise_id')::uuid;
      v_sets := (v_item ->> 'target_sets')::numeric;
      v_reps := (v_item ->> 'target_reps')::numeric;
    exception when others then
      raise exception 'Exercise % has an invalid value', v_idx;
    end;
    if v_exercise_id is null or not exists (select 1 from exercises where id = v_exercise_id) then
      raise exception 'Exercise % is unknown', v_idx;
    end if;
    if v_sets is not null and (v_sets <> trunc(v_sets) or v_sets < 1 or v_sets > 50) then
      raise exception 'Exercise %: target sets must be a whole number from 1 to 50', v_idx;
    end if;
    if v_reps is not null and (v_reps <> trunc(v_reps) or v_reps < 1 or v_reps > 1000) then
      raise exception 'Exercise %: target reps must be a whole number from 1 to 1000', v_idx;
    end if;
  end loop;

  if v_routine_id is null then
    insert into routines (user_id, name) values (v_user_id, btrim(p_name))
    returning id into v_routine_id;
  else
    update routines set name = btrim(p_name) where id = v_routine_id;
    if not found then
      raise exception 'Routine not found';
    end if;
    delete from routine_exercises where routine_id = v_routine_id;
  end if;

  insert into routine_exercises (routine_id, exercise_id, target_sets, target_reps, position)
  select v_routine_id, (e.value ->> 'exercise_id')::uuid,
    (e.value ->> 'target_sets')::integer, (e.value ->> 'target_reps')::integer, e.ordinality
  from jsonb_array_elements(p_exercises) with ordinality as e(value, ordinality);

  return v_routine_id;
exception
  when unique_violation then
    raise exception 'You already have a routine named "%"', btrim(p_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Any session
-- ---------------------------------------------------------------------------

-- Moves a session to another date (and start time; pass the current time to
-- keep it, null to clear it). Crosses weeks by switching plans.
create or replace function reschedule_session(
  p_session_id uuid,
  p_date date,
  p_start_time time default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if not exists (select 1 from sessions where id = p_session_id) then
    raise exception 'Session not found';
  end if;

  v_plan_id := ensure_plan(p_date);
  update sessions
  set planned_date = p_date, planned_start_time = p_start_time, plan_id = v_plan_id
  where id = p_session_id;

  perform rebuild_prs(session_exercise_ids(p_session_id));
  return p_session_id;
end;
$$;

-- Sets status to planned / completed / skipped, keeping PRs consistent.
create or replace function set_session_status(p_session_id uuid, p_status session_status)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_status is null then
    raise exception 'Status is required';
  end if;
  update sessions set status = p_status where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  perform rebuild_prs(session_exercise_ids(p_session_id));
  return p_session_id;
end;
$$;

-- Deletes a session (details, sets and PR rows cascade) and rebuilds PRs for
-- the exercises it contained.
create or replace function delete_session(p_session_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_exercises uuid[] := session_exercise_ids(p_session_id);
begin
  delete from sessions where id = p_session_id;
  if not found then
    raise exception 'Session not found';
  end if;

  perform rebuild_prs(v_exercises);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Conflict rules
-- ---------------------------------------------------------------------------

-- Inserts the default rule set the first time it is called for a user.
create or replace function seed_default_conflict_rules()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_seeded boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  insert into user_settings (user_id) values (v_user_id) on conflict (user_id) do nothing;
  select conflict_rules_seeded into v_seeded from user_settings where user_id = v_user_id for update;
  if v_seeded then
    return;
  end if;

  insert into conflict_rules (user_id, rule_type, name, session_type_a, session_type_b, params) values
    (v_user_id, 'min_hours_between', 'Heavy legs near a hard run', 'lift', 'run',
      '{"hours": 24, "a_lift_focus": ["legs", "lower", "full-body"], "b_run_types": ["tempo", "interval", "long", "race"]}'),
    (v_user_id, 'no_back_to_back_hard', 'No back-to-back hard days', null, null,
      '{"hard_run_types": ["tempo", "interval", "long", "race"], "hard_lift_focus": ["legs", "lower", "full-body"]}'),
    (v_user_id, 'max_days_without_rest', 'Rest at least once a week', null, null,
      '{"max_days": 6}'),
    (v_user_id, 'busy_block_overlap', 'Overlaps a busy block', null, null, '{}');

  update user_settings set conflict_rules_seeded = true where user_id = v_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Permissions
-- ---------------------------------------------------------------------------

revoke execute on function ensure_plan(date) from public, anon;
revoke execute on function assert_run_actuals(numeric, integer, numeric, numeric) from public, anon;
revoke execute on function rebuild_prs(uuid[]) from public, anon;
revoke execute on function session_exercise_ids(uuid) from public, anon;
revoke execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) from public, anon;
revoke execute on function plan_run(date, run_type, time, integer, numeric, integer, integer) from public, anon;
revoke execute on function complete_run(uuid, numeric, integer, integer, numeric, text) from public, anon;
revoke execute on function plan_lift(date, text, time, integer, uuid, text) from public, anon;
revoke execute on function log_lift(uuid, date, text, text, jsonb) from public, anon;
revoke execute on function save_routine(uuid, text, jsonb) from public, anon;
revoke execute on function reschedule_session(uuid, date, time) from public, anon;
revoke execute on function set_session_status(uuid, session_status) from public, anon;
revoke execute on function delete_session(uuid) from public, anon;
revoke execute on function seed_default_conflict_rules() from public, anon;

grant execute on function ensure_plan(date) to authenticated;
grant execute on function assert_run_actuals(numeric, integer, numeric, numeric) to authenticated;
grant execute on function rebuild_prs(uuid[]) to authenticated;
grant execute on function session_exercise_ids(uuid) to authenticated;
grant execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) to authenticated;
grant execute on function plan_run(date, run_type, time, integer, numeric, integer, integer) to authenticated;
grant execute on function complete_run(uuid, numeric, integer, integer, numeric, text) to authenticated;
grant execute on function plan_lift(date, text, time, integer, uuid, text) to authenticated;
grant execute on function log_lift(uuid, date, text, text, jsonb) to authenticated;
grant execute on function save_routine(uuid, text, jsonb) to authenticated;
grant execute on function reschedule_session(uuid, date, time) to authenticated;
grant execute on function set_session_status(uuid, session_status) to authenticated;
grant execute on function delete_session(uuid) to authenticated;
grant execute on function seed_default_conflict_rules() to authenticated;
