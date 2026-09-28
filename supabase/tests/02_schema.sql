-- Schema-level guarantees: the constraints and triggers the migrations add.
--
-- Each negative case runs inside a block that catches the error, so a guard
-- that silently stops working is reported as a failure rather than aborting
-- the run at the first surprise.
\pset pager off
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('99999999-9999-9999-9999-999999999999', 'other@example.com')
on conflict do nothing;

insert into plans (id, user_id, week_start_date) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '2026-09-14'),
  ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', '2026-09-14')
on conflict do nothing;

insert into sessions (id, plan_id, type, planned_date, planned_start_time, planned_duration_min) values
  ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'lift', '2026-09-16', '18:00', 60),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'run',  '2026-09-18', null, null),
  ('77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888', 'run',  '2026-09-16', null, null)
on conflict do nothing;

do $$
declare
  lift_session uuid := '33333333-3333-3333-3333-333333333333';
  run_session  uuid := '44444444-4444-4444-4444-444444444444';
  owner        uuid := '11111111-1111-1111-1111-111111111111';
  failures int := 0;
  before_ts timestamptz;
  after_ts timestamptz;
  n int;
begin
  -- The starter library ships with the app; an empty one means 0003 did not run.
  select count(*) into n from exercises where user_id is null;
  if n = 876 then raise notice 'PASS  seed library has 876 built-in exercises';
  else raise warning 'FAIL  seed library has %, expected 876', n; failures := failures + 1; end if;

  -- 0006: sessions.type decides which detail row a session may carry.
  insert into lift_details (session_id, focus) values (lift_session, 'push');
  insert into run_details (session_id, run_type, target_distance_km) values (run_session, 'tempo', 10);
  raise notice 'PASS  matching detail rows are accepted';

  begin
    insert into run_details (session_id, run_type) values (lift_session, 'easy');
    raise warning 'FAIL  a lift session accepted run details'; failures := failures + 1;
  exception when others then raise notice 'PASS  run details on a lift session are rejected';
  end;

  begin
    insert into lift_details (session_id, focus) values (run_session, 'legs');
    raise warning 'FAIL  a run session accepted lift details'; failures := failures + 1;
  exception when others then raise notice 'PASS  lift details on a run session are rejected';
  end;

  -- 0006: updated_at is maintained by the database, not by whoever writes.
  select updated_at into before_ts from sessions where id = lift_session;
  perform pg_sleep(0.05);
  update sessions set planned_date = '2026-09-17' where id = lift_session;
  select updated_at into after_ts from sessions where id = lift_session;
  if after_ts > before_ts then raise notice 'PASS  updated_at advances on a reschedule';
  else raise warning 'FAIL  updated_at did not move'; failures := failures + 1; end if;

  -- 0006: a duration has to be a real length.
  begin
    update sessions set planned_duration_min = 0 where id = lift_session;
    raise warning 'FAIL  a zero duration was accepted'; failures := failures + 1;
  exception when check_violation then raise notice 'PASS  a zero planned_duration_min is rejected';
  end;

  -- "Saturday, sometime" is a legitimate plan, not an incomplete one.
  begin
    insert into sessions (plan_id, type, planned_date, planned_start_time, planned_duration_min)
    values ('22222222-2222-2222-2222-222222222222', 'lift', '2026-09-20', null, null);
    raise notice 'PASS  an untimed "anytime that day" session is accepted';
  exception when others then
    raise warning 'FAIL  untimed session rejected (%)', sqlerrm; failures := failures + 1;
  end;

  -- 0006: a busy block cannot end before it starts.
  begin
    insert into busy_blocks (user_id, title, start_time, end_time, source)
    values (owner, 'Backwards', '2026-09-16T17:00:00Z', '2026-09-16T09:00:00Z', 'manual');
    raise warning 'FAIL  a backwards busy block was accepted'; failures := failures + 1;
  exception when check_violation then raise notice 'PASS  a backwards busy block is rejected';
  end;

  insert into busy_blocks (user_id, title, start_time, end_time, source)
  values (owner, 'Night shift', '2026-09-17T02:00:00Z', '2026-09-17T10:00:00Z', 'manual');
  raise notice 'PASS  an overnight busy block is accepted';

  if failures > 0 then raise exception '% schema assertion(s) failed', failures; end if;
  raise notice '--- schema assertions passed ---';
end $$;
