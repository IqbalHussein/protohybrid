-- Rest timer preferences (spec flow #3: "configurable per exercise").
--
-- The timer's default lives in application code (DEFAULT_REST_SECONDS); this
-- table only stores per-exercise overrides, so the absence of a row means
-- "use the default" rather than requiring a backfill for all 876 built-ins.
--
-- Keyed by (user_id, exercise_id) rather than a surrogate id: there is exactly
-- one preference per user per exercise, and the composite primary key makes an
-- upsert on conflict the natural write path.

create table exercise_rest_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  -- Capped at an hour: a longer "rest" is a separate workout, and an unbounded
  -- value would let a typo hang the timer indefinitely.
  rest_seconds integer not null check (rest_seconds >= 0 and rest_seconds <= 3600),
  updated_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table exercise_rest_prefs enable row level security;

create policy "Users manage their own rest preferences"
  on exercise_rest_prefs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
