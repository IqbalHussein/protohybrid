-- Conflict rules (MVP #5), Strava sync (MVP #3) and Google Calendar sync
-- (MVP #1). Everything is additive; nothing the logger or the calendar writes
-- today has to change.

-- 1. Ad-hoc sessions skip conflict checks entirely (specs/lift-logger.md flow
--    #1: starting one is the user knowingly overriding the schedule), and an
--    unplanned run pulled in from Strava is the same kind of thing. Nothing
--    recorded the distinction until now.
alter table sessions
  add column ad_hoc boolean not null default false;

-- Backfill: the ad-hoc logger creates the session and starts the workout in
-- the same request, while a lift planned on the calendar is started later. A
-- planned lift started within a minute of being created is indistinguishable
-- and gets marked ad hoc too — harmless, since it was never scheduled ahead.
update sessions s
set ad_hoc = true
from lift_details l
where l.session_id = s.id
  and s.type = 'lift'
  and l.started_at is not null
  and l.started_at - s.created_at < interval '1 minute';

-- 2. Strava reports heart rate, elevation and the activity's real start
--    instant, none of which run_details could hold.
alter table run_details
  add column actual_avg_hr numeric,
  add column actual_elevation_m numeric,
  add column actual_started_at timestamptz,
  add column strava_name text;

-- 3. google_event_id was unique across every user, so two users on the same
--    invite would collide on the second import. It only has to be unique per
--    user — which is also the key the sync upserts on.
alter table busy_blocks drop constraint busy_blocks_google_event_id_key;
alter table busy_blocks
  add constraint busy_blocks_user_google_event_key unique (user_id, google_event_id);

-- 4. conflict_rules has existed since 0001 but was shaped for one rule type.
--    "Rest at least every N days" and "overlaps a busy block" are not about a
--    pair of session types, so those columns become optional; the sides of a
--    min-hours rule live in params, where they can also narrow by run type or
--    lift focus.
alter table conflict_rules
  alter column session_type_a drop not null,
  alter column session_type_b drop not null,
  add column name text,
  add column created_at timestamptz not null default now();

-- The engine in src/lib/calendar/conflicts.ts ignores a type it doesn't know,
-- which would make a typo a silently dead rule.
alter table conflict_rules
  add constraint conflict_rules_known_type check (
    rule_type in ('min_hours_between', 'no_back_to_back_hard', 'max_days_without_rest', 'busy_block_overlap')
  );

-- 5. Per-user state that has no other home. Default conflict rules are
--    inserted the first time a user opens the calendar; this flag keeps them
--    from reappearing after the user deletes them all. It is also where the
--    Phase 2 timezone column goes when APP_TIME_ZONE stops being a constant.
create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  conflict_rules_seeded boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger user_settings_set_updated_at
  before update on user_settings
  for each row execute function set_updated_at();

-- 6. OAuth tokens for Strava and Google. Read and written only by server code
--    running as the user, but RLS still scopes them: in Phase 2 a browser
--    holding the anon key must not be able to read someone else's tokens.
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
alter table oauth_connections enable row level security;

create policy "Users manage their own settings"
  on user_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage their own oauth connections"
  on oauth_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
