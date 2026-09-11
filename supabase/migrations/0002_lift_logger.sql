-- Lift logger schema — implements the "Data model additions" section of
-- specs/lift-logger.md, plus the gaps found reviewing that spec against 0001.
--
-- Open questions resolved per the spec's own recommendations:
--   * warm-up sets are excluded from volume totals and are not PR-eligible
--     (Hevy's convention) — enforced in application code, but `set_type`
--     below is what makes that distinguishable.
--   * `superset_group` is a uuid, for consistency with the rest of the schema.

create type set_type as enum ('warmup', 'working', 'drop', 'failure');
create type pr_record_type as enum (
  'heaviest_weight',  -- most weight moved on a single set, any rep count
  'best_e1rm',        -- Epley: weight * (1 + reps / 30)
  'most_reps',        -- most reps at a given weight
  'best_volume'       -- highest single-set weight * reps
);

-- Exercise library. user_id null means a built-in entry shared by everyone;
-- a non-null user_id is a user's own custom exercise.
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  muscle_group text,
  equipment text,
  is_custom boolean not null default false,
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A custom exercise must have an owner; a built-in must not.
  constraint exercises_custom_ownership check (is_custom = (user_id is not null))
);

-- Names are unique within their scope: once across the built-in library, and
-- once per user for custom entries. Partial indexes because a null user_id
-- would otherwise defeat a plain unique (user_id, name).
create unique index exercises_builtin_name_key
  on exercises (lower(name)) where user_id is null;
create unique index exercises_custom_name_key
  on exercises (user_id, lower(name)) where user_id is not null;

-- Reusable workout templates.
create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- "order" in the spec is a reserved word in SQL; using `position` instead.
create table routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete restrict,
  target_sets integer,
  target_reps integer,
  position integer not null,
  unique (routine_id, position) deferrable initially deferred
);

-- Links a completed session back to the routine it was started from, so the
-- per-routine volume chart (spec Screens #6) has something to group by.
alter table sessions
  add column routine_id uuid references routines (id) on delete set null;

-- lift_sets: exercise identity becomes a real reference. Safe to drop the old
-- free-text column outright because no rows exist yet.
alter table lift_sets
  add column exercise_id uuid not null references exercises (id) on delete restrict,
  add column set_type set_type not null default 'working',
  add column superset_group uuid;

alter table lift_sets drop column exercise_name;

-- Achieved PRs, appended as they happen so the exercise detail view doesn't
-- recompute history on every load.
create table personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete cascade,
  record_type pr_record_type not null,
  value numeric not null,
  -- Context for the record: `most_reps` is meaningful only at a given weight.
  weight numeric,
  reps integer,
  session_id uuid references sessions (id) on delete cascade,
  achieved_at timestamptz not null default now()
);

-- Indexes for the hot paths: previous-performance lookup on the logging
-- screen, and the per-exercise history/chart views.
create index lift_sets_exercise_id_idx on lift_sets (exercise_id);
create index lift_sets_lift_details_id_idx on lift_sets (lift_details_id);
create index sessions_plan_id_idx on sessions (plan_id);
create index sessions_routine_id_idx on sessions (routine_id) where routine_id is not null;
create index sessions_planned_date_idx on sessions (planned_date desc);
create index routine_exercises_routine_id_idx on routine_exercises (routine_id);
create index personal_records_lookup_idx
  on personal_records (user_id, exercise_id, record_type, achieved_at desc);

-- Row Level Security.
alter table exercises enable row level security;
alter table routines enable row level security;
alter table routine_exercises enable row level security;
alter table personal_records enable row level security;

-- exercises needs different logic from every other table: built-in rows have a
-- null user_id and must stay readable by everyone, so the usual
-- `auth.uid() = user_id` policy would hide the entire starter library.
create policy "Users read built-in and their own exercises"
  on exercises for select
  using (user_id is null or auth.uid() = user_id);

create policy "Users create their own custom exercises"
  on exercises for insert
  with check (auth.uid() = user_id);

create policy "Users update their own custom exercises"
  on exercises for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete their own custom exercises"
  on exercises for delete
  using (auth.uid() = user_id);

create policy "Users manage their own routines"
  on routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- routine_exercises has no user_id of its own, so ownership is checked through
-- its routine — same shape as the existing sessions/lift_sets policies.
create policy "Users manage exercises in their own routines"
  on routine_exercises for all
  using (exists (
    select 1 from routines
    where routines.id = routine_exercises.routine_id and routines.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from routines
    where routines.id = routine_exercises.routine_id and routines.user_id = auth.uid()
  ));

create policy "Users manage their own personal records"
  on personal_records for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
