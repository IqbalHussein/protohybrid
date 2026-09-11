-- ProtoHybrid initial schema
-- Mirrors the Data Model section of project-spec.md.
-- user_id columns reference auth.users so the schema is ready for multi-user
-- (Phase 2) without a rewrite, even though v1 only has one user.

create type session_type as enum ('run', 'lift');
create type session_status as enum ('planned', 'completed', 'skipped');
create type run_type as enum ('easy', 'tempo', 'long', 'interval', 'race');
create type busy_block_source as enum ('manual', 'google_calendar');

create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start_date date not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start_date)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans (id) on delete cascade,
  type session_type not null,
  planned_date date not null,
  status session_status not null default 'planned',
  created_at timestamptz not null default now()
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
  strava_activity_id text unique
);

create table lift_details (
  session_id uuid primary key references sessions (id) on delete cascade,
  focus text not null, -- e.g. 'push', 'pull', 'legs', 'full-body'
  notes text
);

create table lift_sets (
  id uuid primary key default gen_random_uuid(),
  lift_details_id uuid not null references lift_details (session_id) on delete cascade,
  exercise_name text not null,
  set_number integer not null,
  reps integer,
  weight numeric,
  rpe numeric
);

create table busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  source busy_block_source not null default 'google_calendar',
  google_event_id text unique
);

create table conflict_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  rule_type text not null, -- e.g. 'min_hours_between'
  session_type_a session_type not null,
  session_type_b session_type not null,
  params jsonb not null default '{}'::jsonb,
  enabled boolean not null default true
);

-- Row Level Security: every user only sees their own rows.
-- v1 has one user, but this makes Phase 2 (multi-user) a config change,
-- not a rewrite.

alter table plans enable row level security;
alter table sessions enable row level security;
alter table run_details enable row level security;
alter table lift_details enable row level security;
alter table lift_sets enable row level security;
alter table busy_blocks enable row level security;
alter table conflict_rules enable row level security;

create policy "Users manage their own plans"
  on plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage sessions in their own plans"
  on sessions for all
  using (exists (select 1 from plans where plans.id = sessions.plan_id and plans.user_id = auth.uid()))
  with check (exists (select 1 from plans where plans.id = sessions.plan_id and plans.user_id = auth.uid()));

create policy "Users manage run details on their own sessions"
  on run_details for all
  using (exists (
    select 1 from sessions
    join plans on plans.id = sessions.plan_id
    where sessions.id = run_details.session_id and plans.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from sessions
    join plans on plans.id = sessions.plan_id
    where sessions.id = run_details.session_id and plans.user_id = auth.uid()
  ));

create policy "Users manage lift details on their own sessions"
  on lift_details for all
  using (exists (
    select 1 from sessions
    join plans on plans.id = sessions.plan_id
    where sessions.id = lift_details.session_id and plans.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from sessions
    join plans on plans.id = sessions.plan_id
    where sessions.id = lift_details.session_id and plans.user_id = auth.uid()
  ));

create policy "Users manage lift sets on their own lifts"
  on lift_sets for all
  using (exists (
    select 1 from lift_details
    join sessions on sessions.id = lift_details.session_id
    join plans on plans.id = sessions.plan_id
    where lift_details.session_id = lift_sets.lift_details_id and plans.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from lift_details
    join sessions on sessions.id = lift_details.session_id
    join plans on plans.id = sessions.plan_id
    where lift_details.session_id = lift_sets.lift_details_id and plans.user_id = auth.uid()
  ));

create policy "Users manage their own busy blocks"
  on busy_blocks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own conflict rules"
  on conflict_rules for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
