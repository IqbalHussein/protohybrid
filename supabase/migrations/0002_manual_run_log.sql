-- Replace the planned Strava sync with manual run logging.
-- Drops the Strava link column, adds the fields Strava would have supplied
-- (HR, elevation gain) as manual inputs, and adds log_run() so a logged run's
-- plan, session, and details are written atomically.

alter table run_details drop column if exists strava_activity_id;

-- actual_avg_hr and actual_elevation_m were already added to the live
-- database outside of migrations; "if not exists" keeps this safe for both
-- that database and a fresh one.
alter table run_details
  add column if not exists actual_avg_hr integer,
  add column if not exists actual_elevation_m numeric,
  add column if not exists notes text;

-- Logs a completed run on p_date. Finds or creates the plan for that ISO week
-- (Monday start). security invoker: runs as the caller, so RLS still applies.
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
  v_user_id uuid := auth.uid();
  v_week_start date := p_date - (extract(isodow from p_date)::integer - 1);
  v_plan_id uuid;
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_distance_km is null or p_distance_km <= 0 then
    raise exception 'Distance must be greater than 0';
  end if;
  if p_duration_sec is null or p_duration_sec <= 0 then
    raise exception 'Duration must be greater than 0';
  end if;

  insert into plans (user_id, week_start_date)
  values (v_user_id, v_week_start)
  on conflict (user_id, week_start_date) do update
    set week_start_date = excluded.week_start_date
  returning id into v_plan_id;

  insert into sessions (plan_id, type, planned_date, status)
  values (v_plan_id, 'run', p_date, 'completed')
  returning id into v_session_id;

  insert into run_details (
    session_id, run_type,
    actual_distance_km, actual_duration_sec, actual_pace_sec_per_km,
    actual_avg_hr, actual_elevation_m, notes
  )
  values (
    v_session_id, p_run_type,
    p_distance_km, p_duration_sec, round(p_duration_sec / p_distance_km)::integer,
    p_avg_hr, p_elevation_gain_m, nullif(trim(p_notes), '')
  );

  return v_session_id;
end;
$$;

revoke execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) from public, anon;
grant execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) to authenticated;
