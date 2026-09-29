-- 0008: the chosen Google calendars.
\pset pager off
\set ON_ERROR_STOP on

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  owner uuid := '11111111-1111-1111-1111-111111111111';
  failures int := 0;
  ids text[];
begin
  insert into oauth_connections (user_id, provider, access_token) values (owner, 'google', 'g')
  on conflict (user_id, provider) do nothing;

  select calendar_ids into ids from oauth_connections where user_id = owner and provider = 'google';
  if ids is null then raise notice 'PASS  a new connection has no calendar choice yet';
  else raise warning 'FAIL  calendar_ids defaulted to %', ids; failures := failures + 1; end if;

  update oauth_connections set calendar_ids = array['primary@example.com', 'classes@example.com']
  where user_id = owner and provider = 'google';
  select calendar_ids into ids from oauth_connections where user_id = owner and provider = 'google';
  if ids = array['primary@example.com', 'classes@example.com'] then raise notice 'PASS  the user can store a calendar choice';
  else raise warning 'FAIL  stored %', ids; failures := failures + 1; end if;

  update oauth_connections set calendar_ids = '{}' where user_id = owner and provider = 'google';
  select calendar_ids into ids from oauth_connections where user_id = owner and provider = 'google';
  if ids = '{}' then raise notice 'PASS  an empty choice is kept distinct from none';
  else raise warning 'FAIL  empty choice read back as %', ids; failures := failures + 1; end if;

  if failures > 0 then raise exception '% 0008 assertion(s) failed', failures; end if;
  raise notice '--- 0008 assertions passed ---';
end $$;

reset role;
