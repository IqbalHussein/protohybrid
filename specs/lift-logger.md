# Lift Logger — Feature Spec

Companion to `project-spec.md` (MVP item #2). Modeled on Hevy's logging flow: fast set entry, previous-performance reference, automatic PR detection, reusable routines.

## Goal

Replace the Apple Note with something that's as fast to log a set in as a text note, but structured enough to show history, trends, and PRs — and ties back into the shared calendar (a logged workout completes a planned `session`, or creates one if logged ad hoc).

## Core user flows

**1. Start a workout**
From the calendar, a planned lift session has a "Start" action that opens a live workout screen pre-filled with whatever was planned (focus/exercises, if specified). A workout can also be started from scratch (no planned session) — this creates a new `session` + `lift_details` row on the fly, dated today. Ad-hoc workouts skip conflict-check logic entirely, even if they land in a restricted timeslot — starting one is treated as the user knowingly overriding the schedule.

**2. Add an exercise**
Search/select from the exercise library (autocomplete by name, filterable by muscle group / equipment). If nothing matches, add a custom exercise (name + muscle group).

**3. Log sets**
For each exercise, add sets one at a time: weight, reps, and set type (warm-up / working / drop / failure). Each new set row shows the previous performance for that exercise (weight × reps from your last session with it) as a ghost/placeholder — the main thing that makes Hevy fast to use, since most sets are "same as last time" or a small progression. RPE is optional, off by default.

Rest timer auto-starts after a working set is logged, configurable per exercise, with a notification when it's done. Can be skipped or adjusted.

**4. Supersets**
Two or more exercises can be grouped so they're logged back-to-back in the UI with no rest timer between them, only after the group's last exercise.

**5. Finish workout**
Marks the session `completed`, sets total duration, shows a summary: total volume, sets, any PRs hit this session.

**6. History / progress**
Per-exercise history view: every past set for that exercise, plus a simple chart (heaviest weight or best e1RM over time, and total volume over time). Volume progression (weight × reps, summed per session) is tracked both per exercise and per routine, so plateaus are visible at either level — a stalled exercise inside an otherwise-progressing routine, or the routine's total volume flattening out overall. Workout history is a reverse-chronological list of completed sessions, each expandable to see the sets logged.

**7. Routines (templates)**
A completed or in-progress workout can be saved as a reusable routine (exercise list + set/rep targets, no weights). Starting a planned lift session can optionally pull from a routine instead of starting blank — this is what "target exercises" in the calendar's planned Lift session actually points to.

## PR detection

On finishing a workout, check each logged working set against history for that exercise and flag:
- Heaviest weight (any rep count)
- Best estimated 1RM (Epley formula: `weight × (1 + reps / 30)`)
- Most reps at a given weight
- Highest single-set volume (weight × reps)

Flagged PRs surface in the finish-workout summary and are stored so they can be shown on the exercise history view without recomputing every time.

## Data model additions

`project-spec.md`'s data model has `lift_details` and `lift_sets` with a free-text `exercise_name`. For history matching, autocomplete, and accurate PR detection, exercise identity needs to be a real reference, not a string match. Proposed additions:

- `exercises` — id, name, muscle_group, equipment, is_custom, user_id (nullable — null for built-in library entries, set for user-created custom exercises)
- `lift_sets` — add `exercise_id` (references `exercises`, replaces free-text `exercise_name`), `set_type` (warmup | working | drop | failure), `superset_group` (nullable int/uuid, groups sets logged as a superset within one session)
- `routines` — id, user_id, name
- `routine_exercises` — id, routine_id, exercise_id, target_sets, target_reps, order
- `personal_records` — id, user_id, exercise_id, record_type (heaviest_weight | best_e1rm | most_reps | best_volume), value, session_id, achieved_at

A seed migration should ship with a starter exercise library sourced from an open dataset (e.g. free-exercise-db) so the app isn't empty on first use, rather than hand-curating a short list.

## Screens

1. **Workout (live logging)** — active exercise list, add exercise, set rows with previous-performance ghost text, rest timer, finish button
2. **Exercise picker** — search + filter by muscle group/equipment, "create custom" option
3. **Workout summary** — shown on finish: duration, volume, PRs hit
4. **History** — list of past completed workouts
5. **Exercise detail** — history + chart for a single exercise
6. **Routines** — list of saved routines, create/edit, plus a per-routine progress view charting total volume over time across sessions that used that routine

## v1 scope vs. later

**In v1:** exercise library + custom exercises, set logging with weight/reps/set type, previous-performance reference, rest timer, PR detection (all four types), workout history, exercise detail charts, routines.

**Push to later:** plate calculator, body measurements/photos, warm-up weight auto-suggestions, supersets UI polish (data model supports it, but v1 UI can treat grouped sets as a nice-to-have rather than launch-blocking), unit conversion (v1 is lb-only, no toggle).

## Pre-implementation review notes

Flagged during final review before build. Address these before/while implementing, not after:

- **Migration is stale.** `supabase/migrations/0001_init.sql` still has `lift_sets.exercise_name` as free text and has no `exercises`, `routines`, `routine_exercises`, or `personal_records` tables, and no `exercise_id` / `set_type` / `superset_group` columns on `lift_sets`. Write a `0002` migration covering the "Data model additions" section above before writing any lift-logger application code.
- **RLS on `exercises` needs different logic than the rest of the schema.** Every other table's policy is `auth.uid() = user_id`. `exercises.user_id` is nullable (null = built-in, shared by all users) — a copy-pasted policy will make built-in exercises invisible. Select policy needs `user_id is null or auth.uid() = user_id`; insert/update/delete restricted to rows the user owns.
- **Per-routine volume chart has no data to draw from.** Nothing links a completed session back to the routine it was started from — `routine_exercises` only defines a routine's targets. Add a `routine_id` to `sessions` or `lift_details` so the per-routine progress view (Screens #6) is actually buildable.
- **No edit/delete flow for logged workouts or sets.** The spec covers logging and finishing a workout but never addresses correcting a bad entry or deleting one after the fact. Needed for v1, not just later.
- **Warm-up sets and volume/PR math are undefined.** Decide explicitly whether warm-up sets count toward total volume and are PR-eligible (Hevy's convention: excluded) rather than leaving it to be guessed during implementation.
- **`superset_group` type is ambiguous** ("nullable int/uuid" in the data model section) — pick one (uuid, for consistency with the rest of the schema) before writing the migration.

