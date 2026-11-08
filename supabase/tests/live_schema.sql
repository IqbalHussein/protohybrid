-- Replica of the live Supabase schema (as of 2026-11-03, after 0002), rebuilt
-- from an information_schema / pg_catalog dump. Used only by
-- scripts/test-db.mjs to test new migrations in PGlite before they are applied
-- to the real database. Not a migration: never run this against Supabase.
--
-- Bodies of set_updated_at() and assert_session_type() were not in the dump;
-- the versions here are behavioural equivalents.

-- ---- Supabase stand-ins -------------------------------------------------
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon;
create role authenticated;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- ---- Enums --------------------------------------------------------------
create type busy_block_source as enum ('manual', 'google_calendar');
create type oauth_provider as enum ('strava', 'google');
create type pr_record_type as enum ('heaviest_weight', 'best_e1rm', 'most_reps', 'best_volume');
create type run_type as enum ('easy', 'tempo', 'long', 'interval', 'race');
create type session_status as enum ('planned', 'completed', 'skipped');
create type session_type as enum ('run', 'lift');
create type set_type as enum ('warmup', 'working', 'drop', 'failure');

-- ---- Tables -------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start_date)
);

create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text,
  equipment text,
  is_custom boolean not null default false,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint exercises_custom_ownership check (is_custom = (user_id is not null))
);

create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete restrict,
  target_sets integer,
  target_reps integer,
  position integer not null,
  unique (routine_id, position) deferrable initially deferred
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans (id) on delete cascade,
  type session_type not null,
  planned_date date not null,
  status session_status not null default 'planned',
  created_at timestamptz not null default now(),
  routine_id uuid references routines (id) on delete set null,
  planned_start_time time,
  planned_duration_min integer check (planned_duration_min is null or planned_duration_min > 0),
  updated_at timestamptz not null default now(),
  ad_hoc boolean not null default false
);

create table run_details (
  session_id uuid primary key references sessions (id) on delete cascade,
  run_type run_type not null,
  target_distance_km numeric,
  target_pace_sec_per_km integer,
  target_duration_sec integer,
  actual_distance_km numeric,
  actual_pace_sec_per_km integer,
  actual_duration_sec integer,
  actual_avg_hr numeric,
  actual_elevation_m numeric,
  actual_started_at timestamptz,
  strava_name text,
  notes text
);

create table lift_details (
  session_id uuid primary key references sessions (id) on delete cascade,
  focus text not null,
  notes text,
  started_at timestamptz,
  completed_at timestamptz
);

create table lift_sets (
  id uuid primary key default gen_random_uuid(),
  lift_details_id uuid not null references lift_details (session_id) on delete cascade,
  set_number integer not null,
  reps integer,
  weight numeric,
  rpe numeric,
  exercise_id uuid not null references exercises (id) on delete restrict,
  set_type set_type not null default 'working',
  superset_group uuid,
  created_at timestamptz not null default now()
);

create table personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  record_type pr_record_type not null,
  value numeric not null,
  weight numeric,
  reps integer,
  session_id uuid references sessions (id) on delete cascade,
  achieved_at timestamptz not null default now()
);

create table exercise_rest_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  rest_seconds integer not null check (rest_seconds >= 0 and rest_seconds <= 3600),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  source busy_block_source not null default 'google_calendar',
  google_event_id text,
  created_at timestamptz not null default now(),
  constraint busy_blocks_time_order check (end_time > start_time),
  constraint busy_blocks_user_google_event_key unique (user_id, google_event_id)
);

create table conflict_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_type text not null,
  session_type_a session_type,
  session_type_b session_type,
  params jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  name text,
  created_at timestamptz not null default now(),
  constraint conflict_rules_known_type check (rule_type = any (array[
    'min_hours_between', 'no_back_to_back_hard', 'max_days_without_rest', 'busy_block_overlap'
  ]))
);

create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  conflict_rules_seeded boolean not null default false,
  updated_at timestamptz not null default now()
);

create table oauth_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider oauth_provider not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  external_account_id text,
  external_account_name text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ---- Triggers -----------------------------------------------------------
create function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function assert_session_type() returns trigger language plpgsql as $$
declare
  v_type session_type;
  v_expected session_type := case tg_table_name when 'run_details' then 'run' else 'lift' end;
begin
  select type into v_type from sessions where id = new.session_id;
  if v_type is distinct from v_expected then
    raise exception '% requires a % session', tg_table_name, v_expected;
  end if;
  return new;
end;
$$;

create trigger sessions_set_updated_at before update on sessions
  for each row execute function set_updated_at();
create trigger user_settings_set_updated_at before update on user_settings
  for each row execute function set_updated_at();
create trigger run_details_match_session_type before insert or update on run_details
  for each row execute function assert_session_type();
create trigger lift_details_match_session_type before insert or update on lift_details
  for each row execute function assert_session_type();

-- ---- RLS ----------------------------------------------------------------
alter table plans enable row level security;
alter table exercises enable row level security;
alter table routines enable row level security;
alter table routine_exercises enable row level security;
alter table sessions enable row level security;
alter table run_details enable row level security;
alter table lift_details enable row level security;
alter table lift_sets enable row level security;
alter table personal_records enable row level security;
alter table exercise_rest_prefs enable row level security;
alter table busy_blocks enable row level security;
alter table conflict_rules enable row level security;
alter table user_settings enable row level security;
alter table oauth_connections enable row level security;

create policy "own" on plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read" on exercises for select using (user_id is null or auth.uid() = user_id);
create policy "insert" on exercises for insert with check (auth.uid() = user_id);
create policy "update" on exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete" on exercises for delete using (auth.uid() = user_id);
create policy "own" on routines for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on routine_exercises for all
  using (exists (select 1 from routines where routines.id = routine_exercises.routine_id and routines.user_id = auth.uid()))
  with check (exists (select 1 from routines where routines.id = routine_exercises.routine_id and routines.user_id = auth.uid()));
create policy "own" on sessions for all
  using (exists (select 1 from plans where plans.id = sessions.plan_id and plans.user_id = auth.uid()))
  with check (exists (select 1 from plans where plans.id = sessions.plan_id and plans.user_id = auth.uid()));
create policy "own" on run_details for all
  using (exists (select 1 from sessions join plans on plans.id = sessions.plan_id where sessions.id = run_details.session_id and plans.user_id = auth.uid()))
  with check (exists (select 1 from sessions join plans on plans.id = sessions.plan_id where sessions.id = run_details.session_id and plans.user_id = auth.uid()));
create policy "own" on lift_details for all
  using (exists (select 1 from sessions join plans on plans.id = sessions.plan_id where sessions.id = lift_details.session_id and plans.user_id = auth.uid()))
  with check (exists (select 1 from sessions join plans on plans.id = sessions.plan_id where sessions.id = lift_details.session_id and plans.user_id = auth.uid()));
create policy "own" on lift_sets for all
  using (exists (select 1 from lift_details join sessions on sessions.id = lift_details.session_id join plans on plans.id = sessions.plan_id where lift_details.session_id = lift_sets.lift_details_id and plans.user_id = auth.uid()))
  with check (exists (select 1 from lift_details join sessions on sessions.id = lift_details.session_id join plans on plans.id = sessions.plan_id where lift_details.session_id = lift_sets.lift_details_id and plans.user_id = auth.uid()));
create policy "own" on personal_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on exercise_rest_prefs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on busy_blocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on conflict_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own" on oauth_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Supabase grants table privileges to anon/authenticated by default; RLS does the gating.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- ---- log_run as applied by 0002 -----------------------------------------
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
  insert into plans (user_id, week_start_date) values (v_user_id, v_week_start)
  on conflict (user_id, week_start_date) do update set week_start_date = excluded.week_start_date
  returning id into v_plan_id;
  insert into sessions (plan_id, type, planned_date, status)
  values (v_plan_id, 'run', p_date, 'completed') returning id into v_session_id;
  insert into run_details (session_id, run_type, actual_distance_km, actual_duration_sec,
    actual_pace_sec_per_km, actual_avg_hr, actual_elevation_m, notes)
  values (v_session_id, p_run_type, p_distance_km, p_duration_sec,
    round(p_duration_sec / p_distance_km)::integer, p_avg_hr, p_elevation_gain_m, nullif(trim(p_notes), ''));
  return v_session_id;
end;
$$;
revoke execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) from public, anon;
grant execute on function log_run(date, run_type, numeric, integer, integer, numeric, text) to authenticated;
