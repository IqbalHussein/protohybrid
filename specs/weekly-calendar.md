# Weekly Calendar — Feature Spec

Companion to `project-spec.md` (MVP item #1). Successor to `specs/lift-logger.md`, which this feature plugs into: a planned lift session on this calendar is what the logger's "start from a planned session" flow opens.

## Goal

One screen that answers "what is my training week, and does it fit around everything else?" Runs and lifts on the same grid, placed around commitments that are already fixed (classes, shifts), with enough time resolution that conflict-checking has real hours to reason about instead of dates.

This is the surface the rest of the MVP hangs off: Strava sync writes actuals onto sessions that live here, Google Calendar sync writes the busy blocks this grid draws around, and conflict warnings render here.

## Core user flows

**1. View a week**

Seven-day grid, Monday-start (matches `plans.week_start_date` and `mondayOf` in `src/lib/lift/week.ts`). Each day column shows its busy blocks as background and its sessions as cards. Previous/next week navigation. Today's column is marked.

A week with nothing in it renders empty and creates nothing — `plans` rows are created lazily on first write, the way `findOrCreatePlanForToday` already does it.

**2. Plan a session**

Add a run or a lift to a day. Minimum required: type and day. Optional at creation: start time, duration, and the type-specific targets.

- **Run** — `run_type` (easy / tempo / long / interval / race — required, the column is NOT NULL), target distance, target pace, target duration
- **Lift** — focus (required, NOT NULL), optionally a routine to pull target exercises from, notes

A session with no start time is an "anytime that day" card, pinned above the timed cards in its column. This case is the default, not an edge case: most planning starts vague ("long run Saturday") and only some sessions earn a committed time.

**3. Reschedule**

Drag a session card to another day or time slot. The drop updates `planned_date`, and `planned_start_time` if dropped onto a timed slot.

Dragging across a week boundary must also reparent the session to the target week's plan — see review notes.

Every drag interaction has a non-drag equivalent (an edit form with date and time fields). The rest of the app is server-rendered with no client JS; the calendar should not become the one screen that breaks without it.

**4. Mark what happened**

A session is `planned`, `completed`, or `skipped`.

- A lift completes by being logged — the logger already sets `sessions.status = 'completed'` on finish.
- A run has no completion path until Strava sync lands, so v1 gives runs a manual "mark complete" with optional actual distance and duration, writing the same `actual_*` columns Strava will later fill automatically.
- Any session can be marked skipped from its card.

A planned session whose date has passed stays `planned`. It is not auto-skipped — it renders as unresolved, so the week reads honestly instead of silently tidying itself up.

**5. Busy blocks (manual)**

Add, edit, and delete non-training commitments by hand: title, start, end. These write `busy_blocks` with `source = 'manual'`.

Google Calendar sync becomes a second writer to this same table with `source = 'google_calendar'`, so the grid does not change when it lands. Manual entry is in v1 specifically so the calendar is useful before any OAuth app is registered, rather than shipping an empty availability layer that waits on Google.

**6. Start a planned lift**

A planned lift card has a "Start" action that opens the logger's live workout screen for that session — the flow `specs/lift-logger.md` #1 describes but the current implementation does not have (today the only entry point is an ad-hoc start from the home page). The action creates `lift_details` if the planned session has no row yet, sets `started_at`, and redirects to `/workout/[id]`.

## Data model additions

`sessions.planned_date` is a `date`. A calendar that places sessions among `busy_blocks` (which are `timestamptz`) and a conflict checker that reasons in hours both need more resolution than a day.

- `sessions` — add `planned_start_time time` (nullable) and `planned_duration_min integer` (nullable). Nullable because "Saturday, sometime" is a legitimate plan, not an incomplete one.
- `sessions` — add `updated_at timestamptz` so reschedules are traceable.
- `busy_blocks` — add `created_at timestamptz not null default now()` for consistency with every other table.

Deliberately **not** changed: `planned_date` stays a `date` rather than becoming `timestamptz`. Converting it would break `startWorkout` in `src/app/workout/actions.ts`, which is under active development. Additive nullable columns let this migration land without touching anything the logger writes.

No new tables. `busy_blocks` and `conflict_rules` have existed since `0001` and have never been used.

## Screens

1. **Week grid** — seven columns, busy blocks as background, session cards, week nav, today marker, conflict warnings inline
2. **Session editor** — create/edit a run or lift: type, day, optional time and duration, type-specific targets. Doubles as the no-JS reschedule path.
3. **Busy block editor** — title, start, end. Manual entries only; synced blocks are read-only.

No separate day view in v1.

## v1 scope vs. later

**In v1:** week grid, create/edit/delete runs and lifts, manual busy blocks, reschedule (drag plus form fallback), mark complete/skipped, manual run actuals, start-planned-lift handoff to the logger.

**Push to later:** month view, multi-week training blocks, copy-week and duplicate-session, recurring sessions, race countdown, drag-to-resize duration, and the conflict rule engine itself — this spec defines only where warnings render.

## Integration points (not built here)

- **Conflict warnings** — this spec reserves the surface: a badge on a session card and a week-level summary line. The rules that populate it are a separate feature. Until it lands, the surface renders nothing.
- **Strava** — fills `run_details.actual_*` and `strava_activity_id`, replacing flow #4's manual run completion.
- **Google Calendar** — second writer to `busy_blocks`.

## Pre-implementation review notes

Flagged before build, same as the lift-logger spec. Address these while implementing, not after.

- **Deleting a session destroys logged history, silently.** `lift_details` cascades from `sessions`, `lift_sets` cascades from `lift_details`, and `personal_records.session_id` cascades too. So a delete on a completed session from the calendar wipes every set logged in it *and* the PRs it set. This is the single most dangerous action in the feature. Either restrict deletion to sessions with status `planned`, or require an explicit confirmation that names what will be lost. Do not ship a bare delete button on a completed card.

- **Cross-week drags must reparent the plan.** `sessions.plan_id` is NOT NULL and `plans` is unique on `(user_id, week_start_date)`. Dragging Sunday to Monday changes the session's week; updating `planned_date` alone leaves a session whose date falls outside its own plan's week, which quietly corrupts every query that reaches sessions through `plan_id`. The reschedule action must resolve the target week's plan — generalize `findOrCreatePlanForToday` to take a date — and update `plan_id` alongside `planned_date`. Worth asking whether `plan_id` should exist at all, since sessions could hang off `user_id` + `planned_date` and derive the week, but that refactor is larger than this feature.

- **Timezone is undefined today, and the calendar is where that stops being ignorable.** `busy_blocks` are `timestamptz`; `planned_start_time` is a zone-less `time`. Comparing them — which grid layout and every future conflict rule require — needs a fixed zone. v1 is single-user: put it in one exported constant (`America/Toronto`), not scattered `new Date()` calls, so Phase 2 swaps a constant for a user column instead of hunting through the codebase.

- **Drag-and-drop is the app's first client component.** Everything so far is server components and form actions with zero `"use client"` — `add/page.tsx` deliberately uses a GET form to stay server-rendered. Drag needs client JS and probably `dnd-kit`. Keep the client boundary at the grid itself with mutations staying server actions, and ship the form-based reschedule first so drag is an enhancement rather than a dependency.

- **`week.ts` is in the wrong place.** `mondayOf` and `toDateString` live in `src/lib/lift/week.ts`, but week math is now shared between the logger and the calendar. Move to `src/lib/week.ts` — after the in-flight logger work merges, not during, since it is a rename that will conflict.

- **Nothing stops a session having both `run_details` and `lift_details`, or neither.** `sessions.type` declares which, but the schema does not enforce it, and the grid renders by joining on type. A malformed row renders wrong rather than erroring. Either enforce it (trigger) or make the query defensive and decide explicitly which wins.

- **Run creation has no existing code path.** Every session written so far comes from `startWorkout`, which hardcodes `type: 'lift'`. Runs get created for the first time in this feature, and `run_details.run_type` being NOT NULL means the create form cannot defer that choice to later.

- **Planned-vs-actual (MVP #4) is only half-buildable right now.** Lift actuals exist through the logger; run actuals do not until Strava. Flow #4's manual run completion is the stopgap — make sure the UI does not imply run data arrived automatically.

- **Empty-week navigation must not create plan rows.** Browsing six weeks forward should leave no trace in `plans`. Read paths query by `(user_id, week_start_date)` and tolerate a miss; only writes create.
