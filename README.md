# ProtoHybrid

Web app for hybrid athletes (lifters who also run) to plan and track both disciplines as one integrated training load. See `project-spec.md` for the full spec.

## Stack

Next.js (App Router, TypeScript, Tailwind) + Supabase (Postgres, auth-ready).

## Getting started

Install dependencies:

```bash
npm install
```

Copy the env file and fill in your Supabase project keys:

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your Supabase project's Settings > API
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — optional, enables Strava sync (see below)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — optional, enables Google Calendar sync (see below)

Apply the database migrations in `supabase/migrations/` in order (`supabase db push` with the Supabase CLI, or paste each file into the SQL editor). Create your user under Authentication > Users in the Supabase dashboard; there's no sign-up page in v1.

Run the dev server:

```bash
npm run dev
```

## Integrations

Both are optional; the app works fully with manual entry. Connect them from **Settings**.

**Strava** — create an API application at https://www.strava.com/settings/api. Set its *Authorization Callback Domain* to your app's host (`localhost` in dev). The app requests `activity:read_all`. Sync pulls runs from the last 30 days on first connect, then incrementally: a run on a day with a planned run fills in that session's actuals and marks it completed; an unplanned run is added as an ad-hoc session.

**Google Calendar** — in your Google Cloud project, enable the Calendar API, configure the OAuth consent screen with the `calendar.readonly` scope (add yourself as a test user), and create an OAuth *Web application* client with `http://localhost:3000/api/auth/google/callback` (plus your production URL) as an authorized redirect URI. Sync imports timed, busy events (skipping all-day, "free", and declined ones) from last week through five weeks ahead into busy blocks.

Sync runs on connect and from the **Sync now** button in Settings.

## Features

- **Lift logger** (`specs/lift-logger.md`) — ad-hoc or planned workouts, exercise library search/filter plus custom exercises, fast set entry (blank fields repeat last time's weight × reps), set types, optional RPE, per-exercise rest timer with notification, edit/delete sets and workouts (PRs are replayed when history changes), automatic PR detection for all four record types, workout summary, history, per-exercise charts, routines with per-routine volume progress.
- **Weekly calendar** — plan runs (type, distance, pace, duration) and lifts (focus, routine) with optional times, drag between days to reschedule, busy blocks (manual or from Google Calendar), week totals.
- **Planned vs. actual** — on each session page and calendar card; runs from Strava or manual entry, lifts from logged sets against routine targets.
- **Conflict warnings** — user-configurable rules in Settings: minimum hours between two kinds of session, no hard sessions back to back, rest-day frequency, and overlap with calendar commitments. Four sensible defaults are created on first use. Ad-hoc and skipped sessions are never flagged.
- **Timezone** — set in Settings; "today", session times, and calendar events use it.

## Structure

```
src/app/              Next.js App Router pages and server actions
src/app/api/auth/     Strava and Google OAuth start/callback routes
src/components/       Shared UI (week board, set forms, rest timer, charts, …)
src/lib/conflicts.ts  Pure conflict-rule engine
src/lib/lift/         Lift logger queries, PR replay, math
src/lib/integrations/ Strava and Google Calendar clients + sync
src/lib/supabase/     Supabase client (browser) and server client helpers
supabase/migrations/  SQL schema
project-spec.md       Full project spec
specs/lift-logger.md  Lift logger spec
```

## Not yet built

Deliberately deferred per the specs: superset grouping UI (the schema supports it), plate calculator, unit conversion (lb only), automatic background sync (Strava webhooks / scheduled Google sync), and writing sessions back to Google Calendar.
