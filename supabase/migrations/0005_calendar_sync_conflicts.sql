-- Calendar, Strava/Google sync, conflict rules, and the lift-logger pieces
-- that 0002/0004 left without storage (per-exercise rest timer, settings).
--
-- 1. Sessions need a time of day. Conflict rules are phrased in hours ("heavy
--    legs within ~24h of a hard run") and busy blocks are timestamps, so a bare
--    planned_date isn't enough. planned_time is wall-clock time in the user's
--    timezone (user_settings.timezone); null means "some time that day".
--
-- 2. Ad-hoc sessions skip conflict checks entirely (specs/lift-logger.md flow
--    #1), so they need to be distinguishable from planned ones. Every lift
--    session that exists before this migration was started ad hoc — there was
--    no way to plan one yet — so they're backfilled as such.
--
-- 3. Strava gives heart rate, elevation, and a start time that run_details
--    had no columns for.
--
-- 4. busy_blocks.google_event_id was unique across all users, which would
--    collide the moment two users share an invite. Scope it per user.
--
-- 5. conflict_rules.session_type_a/b were NOT NULL, but rules like "no rest
--    day in N days" or "busy-block overlap" aren't about a pair of types.

-- 1, 2
alter table sessions
  add column planned_time time,
  add column ad_hoc boolean not null default false,
  add column notes text;

update sessions set ad_hoc = true where type = 'lift';

create index sessions_planned_date_asc_idx on sessions (planned_date, planned_time);

-- 3
alter table run_details
  add column actual_avg_hr numeric,
  add column actual_elevation_m numeric,
  add column actual_started_at timestamptz,
  add column strava_name text;

-- 4
alter table busy_blocks drop constraint busy_blocks_google_event_id_key;
alter table busy_blocks add constraint busy_blocks_user_google_event_key unique (user_id, google_event_id);
create index busy_blocks_user_time_idx on busy_blocks (user_id, start_time);

-- 5
alter table conflict_rules
  alter column session_type_a drop not null,
  alter column session_type_b drop not null,
  add column name text,
  add column created_at timestamptz not null default now();

-- Per-user preferences. One row per user, created lazily by the app.
create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  timezone text not null default 'UTC',
  default_rest_seconds integer not null default 90 check (default_rest_seconds between 0 and 3600),
  -- Default conflict rules are inserted once, the first time the user opens
  -- the app. Tracked here so deleting every rule doesn't resurrect them.
  conflict_rules_seeded boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Rest timer duration, configurable per exercise (spec flow #3).
create table exercise_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  rest_seconds integer not null check (rest_seconds between 0 and 3600),
  primary key (user_id, exercise_id)
);

-- OAuth connections for Strava and Google Calendar. v1 is single-user and
-- these are only ever read server-side, but RLS still scopes them per user.
create type oauth_provider as enum ('strava', 'google');

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

alter table user_settings enable row level security;
alter table exercise_preferences enable row level security;
alter table oauth_connections enable row level security;

create policy "Users manage their own settings"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own exercise preferences"
  on exercise_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own oauth connections"
  on oauth_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
