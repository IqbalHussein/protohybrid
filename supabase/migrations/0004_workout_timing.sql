-- Gaps found implementing the live-logging flow against 0002.
--
-- 1. Finishing a workout is specified to "set total duration" (spec flow #5),
--    but nothing on sessions or lift_details could hold it: durations live on
--    run_details only. Recording start/finish timestamps rather than a
--    precomputed duration keeps the rest-timer and summary math honest if a
--    workout is left open and resumed.
--
-- 2. Exercises within a workout had no ordering. lift_sets.set_number orders
--    sets within one exercise, but nothing ordered the exercises themselves,
--    so the logging screen couldn't render them in the order they were added.
--    Ordering by each exercise's first set needs a timestamp on the set.

alter table lift_details
  add column started_at timestamptz,
  add column completed_at timestamptz;

alter table lift_sets
  add column created_at timestamptz not null default now();

create index lift_sets_order_idx on lift_sets (lift_details_id, created_at);
