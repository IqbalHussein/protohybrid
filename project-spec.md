# ProtoHybrid — Project Spec

## Overview

A web app for hybrid athletes (lifters who also run, runners who also lift) to plan and track both disciplines as one integrated training load, instead of juggling separate apps that don't talk to each other.

**Owner:** Iqbal
**Stage:** Personal tool first (v1), designed to be shareable with other users later (v2+)
**Platform:** Web app
**Stack:** Next.js + Postgres via Supabase (gives auth for free when this opens up to other users)

## The Problem

Lifting apps (Strong, Hevy, notes apps) and running apps (Strava, Garmin) each do their own thing well, but neither knows the other exists. A hybrid athlete has to mentally reconcile: did I plan heavy squats the day before a tempo run? Am I tapering both disciplines correctly before a race? Is my lower-body volume this week actually sane once running is factored in? Today Iqbal tracks runs in Strava and lifts in a bare Apple Note — no shared view, no conflict detection, no history on the lifting side.

## Core Concept

Treat lifting and running as one training load, not two logs. The app's job is a single weekly plan where a run and a lift are aware of each other, plus a record of what actually happened against that plan.

- **Plan** — a week or training block made of Sessions
- **Session** — either a Run or a Lift, with a planned version and an actual (logged) version
  - Run: type (easy / tempo / long / interval / race), target distance, target pace, target duration
  - Lift: type/focus (push / pull / legs / full-body / specific lift focus), target exercises with sets/reps or a simple free-text plan
- **Conflict check** — flags scheduling problems, e.g. heavy lower-body lift within ~24h of a hard run, two high-intensity sessions back to back, no rest day in X days

## MVP Scope (v1 — personal use)

1. **Weekly calendar view** — plan runs and lifts across the week, drag to reschedule. Syncs with Google Calendar so existing non-training commitments (classes, work shifts) show up automatically and sessions get scheduled around real availability
2. **Lift logger** — replaces the Apple Note: exercise, sets, reps, weight, RPE (optional), with history per exercise and basic PR tracking. Starting fresh, no migration from the existing Apple Note
3. **Run logger** — manually log completed runs (date, type, distance, duration, optional avg HR, elevation gain, notes); pace is calculated from distance and duration
4. **Planned vs. actual** — see what was scheduled next to what actually happened
5. **Conflict warnings** — rule-based flags (e.g., heavy legs + hard run within 24h), user-configurable from the start rather than hardcoded

### Explicitly out of scope for v1

- Recovery/HRV scoring or auto-adjusting plans
- Third-party run imports (Strava, Garmin) — runs are logged manually
- Auto-generated training plans (AI coach, periodization templates)
- Multi-user accounts, social features, sharing
- Mobile app (web only for now, mobile-responsive is enough)

These are noted here so the data model doesn't have to be reworked when they're added later — not because they're bad ideas.

## Data Model

The live database (replicated in `supabase/tests/live_schema.sql`) is authoritative. Summary:


- `users` — id, email (single row for now, but modeled from day one so v2 multi-user doesn't require a rewrite)
- `plans` — id, user_id, week_start_date
- `sessions` — id, plan_id, type (run | lift), planned_date, planned_start_time, planned_duration_min, status (planned | completed | skipped), routine_id, ad_hoc
- `run_details` — session_id, run_type, target_distance, target_pace, target_duration, actual_distance, actual_pace, actual_duration, actual_avg_hr, actual_elevation_m, notes
- `lift_details` — session_id, focus, notes, started_at, completed_at
- `lift_sets` — id, lift_details_id, exercise_id, set_number, set_type (warmup | working | drop | failure), reps, weight (lb), rpe
- `exercises` — built-in library plus per-user custom exercises
- `routines` / `routine_exercises` — reusable lift templates with target sets and reps
- `personal_records` — PR history per exercise (heaviest weight, best e1RM, most reps, best volume), rebuilt on every lift change
- `exercise_rest_prefs` — rest-timer seconds per exercise
- `busy_blocks` — id, user_id, title, start_time, end_time, source (manual | google_calendar) — non-training commitments (classes, work shifts) the calendar schedules around, synced from Google Calendar
- `conflict_rules` — id, user_id, name, rule_type (min_hours_between | no_back_to_back_hard | max_days_without_rest | busy_block_overlap), session_type_a/b, params, enabled
- `user_settings` — weight_unit (lb | kg), conflict_rules_seeded
- `oauth_connections` — Google Calendar tokens

## Roadmap

**Phase 1 — Personal MVP** (this spec's scope)
Build the calendar, lift logger, run logger, and conflict warnings for single-user use.

**Phase 2 — Shareable**
Add Supabase auth, per-user data isolation (already modeled via `user_id`), onboarding flow, maybe a landing page.

**Phase 3 — Smarter planning**
Recovery signals, auto-suggested rest days, race taper templates, richer analytics (volume trends, training load over time).

## Open Questions

- Google Calendar API OAuth setup — Google Cloud project with Calendar API already created; still need OAuth Client ID/Secret, consent screen scopes, and redirect URI once the app is scaffolded

## Next Steps

All Phase 1 steps are built:

1. ~~Scaffold Next.js project + Supabase project~~
2. ~~Build data model / schema~~
3. ~~Build lift logger~~
4. ~~Build weekly calendar view~~
5. ~~Build manual run logger~~
6. ~~Wire up Google Calendar OAuth + sync~~ (code done; needs OAuth credentials)
7. ~~Add conflict-check logic (user-configurable rules)~~
