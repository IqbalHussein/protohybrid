-- Row Level Security, exercised as a signed-in user rather than as the table
-- owner — policies do nothing for the owner, so an owner-run check proves
-- nothing. Depends on the fixtures in 02_schema.sql.
\pset pager off
\set ON_ERROR_STOP on

-- A custom exercise belonging to the *other* user, to prove isolation rather
-- than assume it.
insert into exercises (name, muscle_group, is_custom, user_id)
values ('Their Secret Curl', 'biceps', true, '99999999-9999-9999-9999-999999999999')
on conflict do nothing;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare failures int := 0; n int; s uuid;
begin
  -- The exercises policy is the one that differs from every other table:
  -- built-ins have a null user_id and must stay readable by everyone, so a
  -- copy-pasted `auth.uid() = user_id` would hide the entire starter library.
  select count(*) into n from exercises where user_id is null;
  if n = 876 then raise notice 'PASS  all 876 built-in exercises are visible';
  else raise warning 'FAIL  % built-in exercises visible, expected 876', n; failures := failures + 1; end if;

  select count(*) into n from exercises where is_custom and user_id <> '11111111-1111-1111-1111-111111111111';
  if n = 0 then raise notice 'PASS  another user''s custom exercise is hidden';
  else raise warning 'FAIL  % foreign custom exercises visible', n; failures := failures + 1; end if;

  select count(*) into n from sessions where id = '77777777-7777-7777-7777-777777777777';
  if n = 0 then raise notice 'PASS  another user''s session is hidden';
  else raise warning 'FAIL  a foreign session is visible'; failures := failures + 1; end if;

  select count(*) into n from sessions;
  if n > 0 then raise notice 'PASS  own sessions are visible (%)', n;
  else raise warning 'FAIL  own sessions are hidden by RLS'; failures := failures + 1; end if;

  select count(*) into n from busy_blocks where title = 'Night shift';
  if n = 1 then raise notice 'PASS  own busy blocks are visible';
  else raise warning 'FAIL  own busy block hidden'; failures := failures + 1; end if;

  select count(*) into n from plans;
  if n = 1 then raise notice 'PASS  only own plan is visible';
  else raise warning 'FAIL  % plans visible, expected 1', n; failures := failures + 1; end if;

  begin
    insert into sessions (plan_id, type, planned_date)
    values ('88888888-8888-8888-8888-888888888888', 'run', '2026-09-22');
    raise warning 'FAIL  wrote a session into another user''s plan'; failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  writing into another user''s plan is refused';
  end;

  begin
    insert into exercises (name, is_custom, user_id)
    values ('Stolen Lift', true, '99999999-9999-9999-9999-999999999999');
    raise warning 'FAIL  created an exercise owned by another user'; failures := failures + 1;
  exception when insufficient_privilege then
    raise notice 'PASS  creating an exercise for another user is refused';
  end;

  begin
    insert into exercises (name, muscle_group, is_custom, user_id)
    values ('My Custom Lift', 'biceps', true, '11111111-1111-1111-1111-111111111111');
    raise notice 'PASS  own custom exercise is accepted';
  exception when others then
    raise warning 'FAIL  own custom exercise refused (%)', sqlerrm; failures := failures + 1;
  end;

  -- The type-guard trigger added in 0006 reads `sessions` itself, and that
  -- read runs as the calling user under RLS. A legitimate write must still
  -- pass, and the guard must still bite.
  insert into sessions (plan_id, type, planned_date)
  values ('22222222-2222-2222-2222-222222222222', 'lift', '2026-09-23') returning id into s;

  begin
    insert into lift_details (session_id, focus) values (s, 'pull');
    raise notice 'PASS  the type guard lets a valid write through under RLS';
  exception when others then
    raise warning 'FAIL  a legitimate lift_details write was refused (%)', sqlerrm; failures := failures + 1;
  end;

  begin
    insert into run_details (session_id, run_type) values (s, 'easy');
    raise warning 'FAIL  the type guard did not fire under RLS'; failures := failures + 1;
  exception when others then
    raise notice 'PASS  the type guard still fires under RLS';
  end;

  begin
    insert into lift_details (session_id, focus)
    values ('77777777-7777-7777-7777-777777777777', 'legs');
    raise warning 'FAIL  wrote details onto another user''s session'; failures := failures + 1;
  exception when others then
    raise notice 'PASS  details on an invisible session are refused';
  end;

  if failures > 0 then raise exception '% RLS assertion(s) failed', failures; end if;
  raise notice '--- RLS assertions passed ---';
end $$;

reset role;
