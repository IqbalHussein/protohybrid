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
3. **Strava sync** — pull completed runs in automatically (distance, pace, HR, elevation) via the Strava API instead of manual entry
4. **Planned vs. actual** — see what was scheduled next to what actually happened
5. **Conflict warnings** — rule-based flags (e.g., heavy legs + hard run within 24h), user-configurable from the start rather than hardcoded

### Explicitly out of scope for v1

- Recovery/HRV scoring or auto-adjusting plans
- Auto-generated training plans (AI coach, periodization templates)
- Multi-user accounts, social features, sharing
- Mobile app (web only for now, mobile-responsive is enough)

These are noted here so the data model doesn't have to be reworked when they're added later — not because they're bad ideas.

## Data Model (rough sketch)

- `users` — id, email (single row for now, but modeled from day one so v2 multi-user doesn't require a rewrite)
- `plans` — id, user_id, week_start_date
- `sessions` — id, plan_id, type (run | lift), planned_date, status (planned | completed | skipped)
- `run_details` — session_id, run_type, target_distance, target_pace, target_duration, actual_distance, actual_pace, actual_duration, strava_activity_id
- `lift_details` — session_id, focus, notes
- `lift_sets` — id, lift_details_id, exercise_name, set_number, reps, weight, rpe
- `busy_blocks` — id, user_id, title, start_time, end_time, source (manual | google_calendar) — non-training commitments (classes, work shifts) the calendar schedules around, synced from Google Calendar
- `conflict_rules` — id, user_id, rule_type, params (e.g. min_hours_between, session_type_a, session_type_b) — user-configurable conflict-detection rules

## Roadmap

**Phase 1 — Personal MVP** (this spec's scope)
Build the calendar, lift logger, Strava sync, and conflict warnings for single-user use.

**Phase 2 — Shareable**
Add Supabase auth, per-user data isolation (already modeled via `user_id`), onboarding flow, maybe a landing page.

**Phase 3 — Smarter planning**
Recovery signals, auto-suggested rest days, race taper templates, richer analytics (volume trends, training load over time).

## Open Questions

- Strava API rate limits / OAuth setup — needs a Strava developer app registration (only needed once we reach Next Steps #5, not before)
- Google Calendar API OAuth setup — Google Cloud project with Calendar API already created; still need OAuth Client ID/Secret, consent screen scopes, and redirect URI once the app is scaffolded

## Next Steps

1. Scaffold Next.js project + Supabase project
2. Build data model / schema
3. Build lift logger (highest immediate value — replaces the Apple Note)
4. Build weekly calendar view
5. Wire up Strava OAuth + sync
6. Wire up Google Calendar OAuth + sync
7. Add conflict-check logic (user-configurable rules)
