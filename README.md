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
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — optional; without them Settings says Strava isn't set up. See [Integrations](#integrations)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — optional, likewise

Apply the migrations in `supabase/migrations/` **in filename order** via the Supabase CLI or by pasting each into the SQL editor in your Supabase project dashboard:

| Migration | What it adds |
| --- | --- |
| `0001_init.sql` | Core schema from `project-spec.md`, plus RLS on every table |
| `0002_lift_logger.sql` | Exercises, routines, PRs, and `lift_sets.exercise_id` |
| `0003_seed_exercises.sql` | 876 built-in exercises from free-exercise-db |
| `0004_workout_timing.sql` | Workout start/finish timestamps and set ordering |
| `0005_rest_preferences.sql` | Per-exercise rest-timer overrides |
| `0006_weekly_calendar.sql` | Session start time and duration, busy-block timestamps |
| `0007_conflicts_and_sync.sql` | Ad-hoc flag on sessions, Strava fields on runs, per-user Google event ids, conflict-rule columns, `user_settings`, `oauth_connections` |
| `0008_google_calendar_choice.sql` | Which Google calendars feed busy blocks |

Run the test suite (the training rules — volume, PRs, week math, grid layout — are covered without needing a database):

```bash
npm test
```

To check the migrations themselves, with Docker running:

```bash
npm run test:db
```

That applies every migration in order to a throwaway Postgres container and asserts the schema behaves — the constraints, the session-type triggers, and the RLS policies as a signed-in user rather than as the table owner (policies do nothing for the owner, so an owner-run check proves nothing). Supabase's `auth` schema, `auth.uid()` and `authenticated` role are stubbed in `supabase/tests/`. Your real project is never touched.

Run the dev server:

```bash
npm run dev
```

## Project status

Done — Next Steps #1–#7 in `project-spec.md`, i.e. the whole v1 MVP:

- **Scaffold and schema** (#1–#2)
- **Lift logger** (#3, `specs/lift-logger.md`) — exercise library and custom exercises, set logging with previous-performance reference, rest timer, supersets, PR detection, history, per-exercise and per-routine progress charts, routines
- **Weekly calendar** (#4, `specs/weekly-calendar.md`) — week grid with busy blocks, create/edit/delete runs and lifts, reschedule by drag or by form, mark complete/skipped, manual run actuals, and the start-planned-lift handoff into the logger

- **Strava sync** (#5) — a synced run completes the run planned that day (preferring a matching run type) and fills in distance, pace, heart rate and elevation; an unplanned run is filed as an ad-hoc session. Re-syncing is idempotent
- **Google Calendar sync** (#6) — timed, busy events from the calendars ticked in Google become read-only busy blocks; all-day, "free" and declined events are skipped, and events deleted in Google are removed
- **Conflict rules** (#7) — `src/lib/calendar/conflicts.ts`, a pure engine with four rule types (minimum hours between two kinds of session, no hard sessions back to back, rest-day frequency, overlap with a commitment). Four defaults are seeded once per user and every threshold is editable in Settings. Ad-hoc and skipped sessions are never flagged

Sync runs when you connect, from **Sync now** in Settings, and — once [background sync](#background-sync) is set up — on its own.

**Time zone:** v1 is single-user, so the app's zone is one constant, `APP_TIME_ZONE` in `src/lib/time.ts`. Phase 2 swaps it for a user column in that one place.

## Integrations

Both are optional and read-only. Tokens are stored in `oauth_connections`, scoped by RLS.

**Strava:** create an app at <https://www.strava.com/settings/api>. Set its *Authorization Callback Domain* to your app's host (`localhost` for development), then set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`. The first sync reaches back 30 days; later ones re-read the 3 days before the last sync so edits made on Strava come through.

**Google Calendar:** in your Google Cloud project, enable the Calendar API, configure the OAuth consent screen with the `calendar.readonly` scope (add yourself as a test user while the app is in testing), and create an OAuth client of type *Web application* with `http://localhost:3000/api/auth/google/callback` (and your production URL) as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`. Sync covers last week through five weeks ahead. Only your primary calendar is imported until you choose others in Settings — calendars other people share with you are labelled there, since their events aren't your commitments.

Then connect each one from **Settings**.

## Background sync

Optional, and needs a deployment with a public URL. Set `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `STRAVA_WEBHOOK_VERIFY_TOKEN` (see `.env.local.example`).

- **Scheduled sync.** `vercel.json` calls `/api/cron/sync` daily at 10:00 UTC, which syncs every Strava and Google connection. Daily is the most Vercel's Hobby plan allows; on Pro, tighten the schedule (e.g. `0 * * * *`) to keep Google busy blocks fresher. Elsewhere, have any scheduler `GET` that path with `Authorization: Bearer $CRON_SECRET`.
- **Strava webhook.** New and edited runs arrive within minutes. Register the subscription once, after deploying:

  ```bash
  curl -X POST https://www.strava.com/api/v3/push_subscriptions \
    -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
    -F callback_url=https://<your-domain>/api/webhooks/strava \
    -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
  ```

  Deleting an activity on Strava leaves the run in your history, the same as disconnecting does. If you revoke the app on Strava's side, the webhook drops the stored tokens — after confirming with Strava, since its events aren't signed.

The service-role key bypasses RLS, so background sync only runs code that filters by user explicitly: every sync read is scoped to the user it's syncing.

## Structure

```
src/app/             Next.js App Router pages and server actions
src/components/      Shared UI; the only client components are the rest
                     timer, the charts and the calendar grid
src/lib/             Pure rules and queries, with co-located *.test.ts
src/lib/lift/        Lift logger: volume, PRs, supersets, routines, charts
src/lib/calendar/    Week grid: layout geometry, run maths, view model, conflict rules
src/lib/integrations/ Strava and Google Calendar OAuth and sync
src/lib/supabase/    Supabase client (browser) and server client helpers
supabase/migrations/ SQL schema, applied in filename order
project-spec.md      Full project spec
specs/               Per-feature specs
```
