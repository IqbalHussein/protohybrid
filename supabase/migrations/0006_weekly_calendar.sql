-- Weekly calendar — implements the "Data model additions" section of
-- specs/weekly-calendar.md, plus the schema gaps its pre-implementation
-- review flagged.
--
-- Every column here is additive and nullable (or defaulted), so nothing the
-- lift logger writes has to change. In particular `sessions.planned_date`
-- stays a `date`: converting it to timestamptz would break `startWorkout`,
-- and a separate nullable time gives the grid the resolution it needs without
-- forcing every plan to commit to an hour.

alter table sessions
  -- Zone-less on purpose: a plan is made in wall-clock terms ("squats at
  -- 6pm"), and the zone it is read in is APP_TIME_ZONE in src/lib/time.ts.
  add column planned_start_time time,
  add column planned_duration_min integer check (planned_duration_min is null or planned_duration_min > 0),
  add column updated_at timestamptz not null default now();

alter table busy_blocks
  add column created_at timestamptz not null default now();

-- A busy block that ends before it starts would render as a negative-height
-- block on the grid. Google Calendar will be a second writer to this table, so
-- the guarantee belongs in the schema rather than in one form handler.
alter table busy_blocks
  add constraint busy_blocks_time_order check (end_time > start_time);

-- The grid reads one week of blocks at a time, per user.
create index busy_blocks_user_start_idx on busy_blocks (user_id, start_time);

-- Reschedules are traceable only if something maintains updated_at. A trigger
-- rather than application code, because the calendar, the logger and (later)
-- Strava all write sessions.
create or replace function set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sessions_set_updated_at
  before update on sessions
  for each row execute function set_updated_at();

-- `sessions.type` declares whether a session is a run or a lift, but nothing
-- stopped a row having both detail rows or neither — and the grid renders by
-- joining on type, so a malformed row would render wrong instead of erroring.
-- The review offered a trigger or a defensive query; this does both. The
-- trigger makes "type wins" true in the data, and the query layer still
-- tolerates a miss rather than throwing at render time.
create or replace function assert_session_type() returns trigger
language plpgsql
as $$
declare
  expected session_type;
  actual session_type;
begin
  expected := case tg_argv[0] when 'run' then 'run'::session_type else 'lift'::session_type end;
  select type into actual from sessions where id = new.session_id;

  if actual is distinct from expected then
    raise exception 'session % is a % session; it cannot have % details',
      new.session_id, actual, expected;
  end if;

  return new;
end;
$$;

create trigger run_details_match_session_type
  before insert or update of session_id on run_details
  for each row execute function assert_session_type('run');

create trigger lift_details_match_session_type
  before insert or update of session_id on lift_details
  for each row execute function assert_session_type('lift');
