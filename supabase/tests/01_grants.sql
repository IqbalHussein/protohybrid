-- Run after the migrations: hand the `authenticated` role the same shape of
-- access Supabase gives it, so the RLS tests measure policies rather than
-- missing grants.
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on auth.users to authenticated;
grant execute on function auth.uid() to authenticated;
