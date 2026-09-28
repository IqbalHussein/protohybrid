-- 0007: conflict rules, Strava and Google sync. Depends on the fixtures in
-- 02_schema.sql.
\pset pager off
\set ON_ERROR_STOP on

-- Another user's token, written as the table owner, to prove it stays hidden.
insert into oauth_connections (user_id, provider, access_token)
values ('99999999-9999-9999-9999-999999999999', 'strava', 'their-secret-token')
on conflict do nothing;

do $$
declare
  owner uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  failures int := 0;
  n int;
  flag boolean;
begin
  -- A session is planned unless something says otherwise.
  select ad_hoc into flag from sessions where id = '44444444-4444-4444-4444-444444444444';
  if flag = false then raise notice 'PASS  sessions default to not ad hoc';
  else raise warning 'FAIL  ad_hoc defaulted to %', flag; failures := failures + 1; end if;

  -- Rules that aren't about a pair of session types.
  begin
    insert into conflict_rules (user_id, rule_type, params, name)
    values (owner, 'max_days_without_rest', '{"days": 6}', 'Rest day');
    raise notice 'PASS  a rule without session types is accepted';
  exception when others then
    raise warning 'FAIL  a rule without session types was rejected (%)', sqlerrm; failures := failures + 1;
  end;

  begin
    insert into conflict_rules (user_id, rule_type, params) values (owner, 'min_hours_betwen', '{}');
    raise warning 'FAIL  a misspelled rule type was accepted'; failures := failures + 1;
  exception when check_violation then raise notice 'PASS  an unknown rule type is rejected';
  end;

  -- google_event_id is unique per user, not globally.
  insert into busy_blocks (user_id, title, start_time, end_time, source, google_event_id)
  values (owner, 'Shared invite', '2026-09-18T13:00:00Z', '2026-09-18T14:00:00Z', 'google_calendar', 'evt-1');

  begin
    insert into busy_blocks (user_id, title, start_time, end_time, source, google_event_id)
    values (other, 'Shared invite', '2026-09-18T13:00:00Z', '2026-09-18T14:00:00Z', 'google_calendar', 'evt-1');
    raise notice 'PASS  two users can import the same Google event';
  exception when unique_violation then
    raise warning 'FAIL  a second user importing the same event collided'; failures := failures + 1;
  end;

  begin
    insert into busy_blocks (user_id, title, start_time, end_time, source, google_event_id)
    values (owner, 'Shared invite', '2026-09-18T13:00:00Z', '2026-09-18T14:00:00Z', 'google_calendar', 'evt-1');
    raise warning 'FAIL  one user imported the same event twice'; failures := failures + 1;
  exception when unique_violation then raise notice 'PASS  one user cannot import the same event twice';
  end;

  -- Strava's extra fields.
  update run_details
  set actual_avg_hr = 151.3, actual_elevation_m = 42, actual_started_at = now(), strava_name = 'Morning Run'
  where session_id = '44444444-4444-4444-4444-444444444444';
  raise notice 'PASS  run_details holds heart rate, elevation and the Strava name';

  if failures > 0 then raise exception '% 0007 schema assertion(s) failed', failures; end if;
  raise notice '--- 0007 schema assertions passed ---';
end $$;

-- The rest runs as the signed-in user, so the policies are what's measured.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  owner uuid := '11111111-1111-1111-1111-111111111111';
  other uuid := '99999999-9999-9999-9999-999999999999';
  failures int := 0;
  n int;
begin
  -- Seeding default rules: the first request claims it, a racing second
  -- request gets nothing back and so inserts nothing (src/lib/calendar/rules.ts).
  insert into user_settings (user_id) values (owner) on conflict do nothing;

  with claimed as (
    update user_settings set conflict_rules_seeded = true
    where user_id = owner and conflict_rules_seeded = false returning 1
  ) select count(*) into n from claimed;
  if n = 1 then raise notice 'PASS  the first request claims rule seeding';
  else raise warning 'FAIL  first claim returned % rows', n; failures := failures + 1; end if;

  with claimed as (
    update user_settings set conflict_rules_seeded = true
    where user_id = owner and conflict_rules_seeded = false returning 1
  ) select count(*) into n from claimed;
  if n = 0 then raise notice 'PASS  a second request cannot claim it again';
  else raise warning 'FAIL  seeding was claimed twice'; failures := failures + 1; end if;

  begin
    insert into user_settings (user_id) values (other);
    raise warning 'FAIL  created settings for another user'; failures := failures + 1;
  exception when insufficient_privilege then raise notice 'PASS  settings for another user are refused';
  end;

  -- OAuth tokens are the most sensitive rows in the schema.
  select count(*) into n from oauth_connections;
  if n = 0 then raise notice 'PASS  another user''s OAuth token is hidden';
  else raise warning 'FAIL  % foreign OAuth rows visible', n; failures := failures + 1; end if;

  begin
    insert into oauth_connections (user_id, provider, access_token) values (other, 'google', 'planted');
    raise warning 'FAIL  wrote an OAuth connection for another user'; failures := failures + 1;
  exception when insufficient_privilege then raise notice 'PASS  writing another user''s OAuth connection is refused';
  end;

  insert into oauth_connections (user_id, provider, access_token) values (owner, 'strava', 'mine');
  select count(*) into n from oauth_connections;
  if n = 1 then raise notice 'PASS  own OAuth connection is visible';
  else raise warning 'FAIL  % OAuth rows visible, expected 1', n; failures := failures + 1; end if;

  update oauth_connections set access_token = 'stolen' where user_id = other;
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  another user''s token cannot be overwritten';
  else raise warning 'FAIL  overwrote another user''s token'; failures := failures + 1; end if;

  if failures > 0 then raise exception '% 0007 RLS assertion(s) failed', failures; end if;
  raise notice '--- 0007 RLS assertions passed ---';
end $$;

reset role;
