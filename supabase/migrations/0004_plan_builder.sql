-- Plan builder: training profiles, training blocks, plan metadata on sessions,
-- and the RPCs that accept a generated block and swap two planned sessions.
--
-- Safe to re-run: tables and columns use if not exists, functions use create
-- or replace, policies and triggers are dropped and recreated.
--
-- Like 0003, every function is security invoker so RLS applies, and
-- referenced rows are checked explicitly.

-- ---------------------------------------------------------------------------
-- 1. training_profiles
-- ---------------------------------------------------------------------------

create table if not exists training_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preset text check (preset is null or preset in ('builder', 'lifter', 'runner', 'hybrid')),
  w_strength smallint not null check (w_strength between 0 and 100),
  w_hypertrophy smallint not null check (w_hypertrophy between 0 and 100),
  w_endurance smallint not null check (w_endurance between 0 and 100),
  days_per_week smallint not null check (days_per_week between 2 and 7),
  minutes_per_day smallint not null check (minutes_per_day between 10 and 300),
  minutes_by_weekday jsonb not null default '{}'::jsonb check (jsonb_typeof(minutes_by_weekday) = 'object'),
  rest_days smallint[] not null default '{}' check (rest_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  goal_type text not null default 'none' check (goal_type in ('none', 'race', 'strength')),
  race_distance_km numeric check (race_distance_km is null or (race_distance_km > 0 and race_distance_km <= 1000)),
  race_date date,
  experience text not null default 'intermediate' check (experience in ('beginner', 'intermediate', 'advanced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_profiles_weights_sum check (w_strength + w_hypertrophy + w_endurance = 100),
  constraint training_profiles_race_goal check (
    goal_type <> 'race' or (race_distance_km is not null and race_date is not null)
  )
);

drop trigger if exists training_profiles_set_updated_at on training_profiles;
create trigger training_profiles_set_updated_at before update on training_profiles
  for each row execute function set_updated_at();

alter table training_profiles enable row level security;
drop policy if exists "own" on training_profiles;
create policy "own" on training_profiles for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. training_blocks
-- ---------------------------------------------------------------------------

create table if not exists training_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  start_date date not null check (extract(isodow from start_date) = 1),
  weeks smallint not null check (weeks between 1 and 12),
  status text not null default 'active' check (status in ('active', 'replaced')),
  profile_snapshot jsonb not null,
  relaxations jsonb not null default '[]'::jsonb,
  generator_version text not null,
  summary text,
  created_at timestamptz not null default now()
);

create unique index if not exists training_blocks_one_active
  on training_blocks (user_id) where status = 'active';

alter table training_blocks enable row level security;
drop policy if exists "own" on training_blocks;
create policy "own" on training_blocks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. sessions: plan metadata
-- ---------------------------------------------------------------------------

alter table sessions
  add column if not exists block_id uuid references training_blocks (id) on delete set null;
alter table sessions
  add column if not exists intensity text
    constraint sessions_intensity_check check (intensity is null or intensity in ('easy', 'moderate', 'hard'));
alter table sessions
  add column if not exists rationale text
    constraint sessions_rationale_length check (rationale is null or char_length(rationale) <= 500);
alter table sessions
  add column if not exists prescription jsonb
    constraint sessions_prescription_object check (prescription is null or jsonb_typeof(prescription) = 'object');

create index if not exists sessions_block_id_idx on sessions (block_id);

-- ---------------------------------------------------------------------------
-- 4. accept_training_block
-- ---------------------------------------------------------------------------

-- Saves a generated block. p_sessions is an array of
--   {"date", "type": "run"|"lift", "run_type", "focus", "duration_min",
--    "intensity", "rationale", "prescription"}
-- The caller's previous active block is marked replaced and its planned
-- sessions from p_today on are deleted; completed, skipped and past sessions
-- stay. Everything is validated before anything is written.
create or replace function accept_training_block(
  p_start_date date,
  p_weeks integer,
  p_today date,
  p_profile jsonb,
  p_relaxations jsonb,
  p_summary text,
  p_generator_version text,
  p_sessions jsonb,
  p_allow_same_day_hard boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_idx integer := 0;
  v_date date;
  v_type text;
  v_duration numeric;
  v_focus text;
  v_end date;
  v_block_id uuid;
  v_old_block uuid;
  v_old_exercises uuid[] := '{}';
  v_plan_id uuid;
  v_session_id uuid;
  v_item_type text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_start_date is null or extract(isodow from p_start_date) <> 1 then
    raise exception 'Block must start on a Monday';
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 12 then
    raise exception 'Block length must be between 1 and 12 weeks';
  end if;
  if p_today is null then
    raise exception 'Today is required';
  end if;
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Profile snapshot must be an object';
  end if;
  if p_relaxations is null or jsonb_typeof(p_relaxations) <> 'array' then
    raise exception 'Relaxations must be an array';
  end if;
  if p_generator_version is null or btrim(p_generator_version) = '' then
    raise exception 'Generator version is required';
  end if;
  if p_summary is not null and char_length(p_summary) > 2000 then
    raise exception 'Summary is too long';
  end if;
  if p_sessions is null or jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0 then
    raise exception 'Add at least one session';
  end if;
  if jsonb_array_length(p_sessions) > 200 then
    raise exception 'Too many sessions';
  end if;

  v_end := p_start_date + 7 * p_weeks;

  for v_item in select value from jsonb_array_elements(p_sessions) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Session % is malformed', v_idx;
    end if;
    begin
      v_date := (v_item ->> 'date')::date;
      v_duration := (v_item ->> 'duration_min')::numeric;
    exception when others then
      raise exception 'Session % has an invalid value', v_idx;
    end;
    if v_date is null or v_date < p_start_date or v_date >= v_end then
      raise exception 'Session % is outside the block', v_idx;
    end if;
    v_type := v_item ->> 'type';
    if v_type is null or v_type not in ('run', 'lift') then
      raise exception 'Session % needs a type of run or lift', v_idx;
    end if;
    if v_type = 'run' then
      begin
        perform (v_item ->> 'run_type')::run_type;
      exception when others then
        raise exception 'Session % needs a valid run type', v_idx;
      end;
      if v_item ->> 'run_type' is null then
        raise exception 'Session % needs a valid run type', v_idx;
      end if;
    else
      v_focus := btrim(coalesce(v_item ->> 'focus', ''));
      if v_focus = '' or char_length(v_focus) > 50 then
        raise exception 'Session % needs a focus of 1 to 50 characters', v_idx;
      end if;
    end if;
    if v_duration is null or v_duration <> trunc(v_duration) or v_duration < 1 or v_duration > 1440 then
      raise exception 'Session %: duration must be a whole number from 1 to 1440 minutes', v_idx;
    end if;
    if coalesce(v_item ->> 'intensity', '') not in ('easy', 'moderate', 'hard') then
      raise exception 'Session % needs an intensity of easy, moderate or hard', v_idx;
    end if;
    if jsonb_typeof(v_item -> 'rationale') is distinct from 'string'
       or char_length(v_item ->> 'rationale') > 500 then
      raise exception 'Session %: rationale must be text of at most 500 characters', v_idx;
    end if;
    v_item_type := jsonb_typeof(v_item -> 'prescription');
    if v_item_type is distinct from 'object' then
      raise exception 'Session %: prescription must be an object', v_idx;
    end if;
  end loop;

  -- Replace the active block: drop its upcoming planned sessions.
  select id into v_old_block
  from training_blocks
  where user_id = v_user_id and status = 'active'
  for update;

  if v_old_block is not null then
    select coalesce(array_agg(distinct x), '{}') into v_old_exercises
    from (
      select unnest(session_exercise_ids(s.id)) as x
      from sessions s
      where s.block_id = v_old_block and s.status = 'planned' and s.planned_date >= p_today
    ) e;

    delete from sessions
    where block_id = v_old_block and status = 'planned' and planned_date >= p_today;

    perform rebuild_prs(v_old_exercises);

    update training_blocks set status = 'replaced' where id = v_old_block;
  end if;

  insert into training_blocks (user_id, start_date, weeks, status, profile_snapshot, relaxations, generator_version, summary)
  values (v_user_id, p_start_date, p_weeks, 'active', p_profile, p_relaxations, btrim(p_generator_version), nullif(btrim(p_summary), ''))
  returning id into v_block_id;

  for v_item in select value from jsonb_array_elements(p_sessions) loop
    v_date := (v_item ->> 'date')::date;
    v_type := v_item ->> 'type';

    -- Own statement: see the comment in log_run about RLS snapshots.
    v_plan_id := ensure_plan(v_date);
    insert into sessions (
      plan_id, type, planned_date, status, planned_start_time, planned_duration_min,
      block_id, intensity, rationale, prescription
    )
    values (
      v_plan_id, v_type::session_type, v_date, 'planned', null, (v_item ->> 'duration_min')::numeric::integer,
      v_block_id, v_item ->> 'intensity', v_item ->> 'rationale', v_item -> 'prescription'
    )
    returning id into v_session_id;

    if v_type = 'run' then
      insert into run_details (session_id, run_type, target_duration_sec)
      values (v_session_id, (v_item ->> 'run_type')::run_type, ((v_item ->> 'duration_min')::numeric::integer) * 60);
    else
      insert into lift_details (session_id, focus, notes)
      values (v_session_id, btrim(v_item ->> 'focus'), null);
    end if;
  end loop;

  if coalesce(p_allow_same_day_hard, false) then
    perform seed_default_conflict_rules();
    update conflict_rules
    set params = params || '{"allow_same_day": true}'::jsonb
    where user_id = v_user_id and rule_type = 'no_back_to_back_hard';
  end if;

  return v_block_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. swap_sessions
-- ---------------------------------------------------------------------------

-- Swaps the date, start time and week of two planned sessions.
create or replace function swap_sessions(p_session_a uuid, p_session_b uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a sessions%rowtype;
  b sessions%rowtype;
  v_plan_a uuid;
  v_plan_b uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_session_a is null or p_session_b is null or p_session_a = p_session_b then
    raise exception 'Choose two different sessions';
  end if;

  select * into a from sessions where id = p_session_a;
  if not found then
    raise exception 'Session not found';
  end if;
  select * into b from sessions where id = p_session_b;
  if not found then
    raise exception 'Session not found';
  end if;
  if a.status <> 'planned' or b.status <> 'planned' then
    raise exception 'Only planned sessions can be swapped';
  end if;

  v_plan_a := ensure_plan(b.planned_date);
  v_plan_b := ensure_plan(a.planned_date);

  update sessions
  set planned_date = b.planned_date, planned_start_time = b.planned_start_time, plan_id = v_plan_a
  where id = a.id;
  update sessions
  set planned_date = a.planned_date, planned_start_time = a.planned_start_time, plan_id = v_plan_b
  where id = b.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Permissions
-- ---------------------------------------------------------------------------

-- Supabase grants these by default for new public tables; stated here so the
-- migration does not depend on that. RLS does the gating.
grant select, insert, update, delete on training_profiles, training_blocks to authenticated;

revoke execute on function accept_training_block(date, integer, date, jsonb, jsonb, text, text, jsonb, boolean) from public, anon;
revoke execute on function swap_sessions(uuid, uuid) from public, anon;

grant execute on function accept_training_block(date, integer, date, jsonb, jsonb, text, text, jsonb, boolean) to authenticated;
grant execute on function swap_sessions(uuid, uuid) to authenticated;
