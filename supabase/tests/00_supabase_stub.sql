-- Stand-ins for what Supabase provides, so supabase/migrations/ can be applied
-- to stock Postgres for testing. Not part of the app's schema: this file is
-- never run against the real project.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase derives auth.uid() from the request's JWT claims. A settable GUC
-- exercises the policies the same way, so tests can switch users.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase's role for a signed-in user: ordinary privileges and, crucially, no
-- BYPASSRLS — policies are not exercised at all by the table owner.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
