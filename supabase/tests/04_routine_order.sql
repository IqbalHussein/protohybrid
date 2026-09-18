-- Reordering a routine's exercises.
--
-- routine_exercises is unique on (routine_id, position) and DEFERRABLE
-- INITIALLY DEFERRED, so the constraint is checked at commit. Each PostgREST
-- request is its own transaction, which means a naive two-request swap fails
-- at the first request's commit — the reason `moveRoutineExercise` parks a row
-- at a negative position instead. This file pins down both halves of that,
-- because it is the kind of claim that quietly stops being true.
--
-- Statements run in autocommit here on purpose: one transaction each, exactly
-- as the application issues them. That means no DO block around the swap.
\pset pager off
\set ON_ERROR_STOP on

delete from routines where name = 'Order Test';
insert into routines (id, user_id, name)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Order Test');

insert into routine_exercises (id, routine_id, exercise_id, position)
select '66666666-6666-6666-6666-66666666666a', '55555555-5555-5555-5555-555555555555', id, 0
from exercises where user_id is null order by name limit 1;

insert into routine_exercises (id, routine_id, exercise_id, position)
select '66666666-6666-6666-6666-66666666666b', '55555555-5555-5555-5555-555555555555', id, 1
from exercises where user_id is null order by name offset 1 limit 1;

-- The naive swap must fail. Errors are tolerated for this one statement, and
-- the error it raises is the point of the test, not a problem with the run.
\echo '    (the next ERROR is expected — it is what this test asserts)'
\set ON_ERROR_STOP off
\set VERBOSITY terse
update routine_exercises set position = 1 where id = '66666666-6666-6666-6666-66666666666a';
\set VERBOSITY default
\set ON_ERROR_STOP on

do $$
begin
  if (select position from routine_exercises where id = '66666666-6666-6666-6666-66666666666a') = 0 then
    raise notice 'PASS  a naive single-request swap is rejected, as the code assumes';
  else
    raise exception 'FAIL  a naive swap succeeded — the parking workaround is no longer needed';
  end if;
end $$;

-- The three-step parking swap the action actually performs, one transaction
-- each. ON_ERROR_STOP is on, so any failure here aborts the run.
update routine_exercises set position = -1 where id = '66666666-6666-6666-6666-66666666666a';
update routine_exercises set position =  0 where id = '66666666-6666-6666-6666-66666666666b';
update routine_exercises set position =  1 where id = '66666666-6666-6666-6666-66666666666a';

do $$
begin
  if (select position from routine_exercises where id = '66666666-6666-6666-6666-66666666666b') = 0
     and (select position from routine_exercises where id = '66666666-6666-6666-6666-66666666666a') = 1 then
    raise notice 'PASS  the negative-position parking swap reorders the routine';
  else
    raise exception 'FAIL  positions did not end up swapped';
  end if;
  raise notice '--- routine ordering assertions passed ---';
end $$;
