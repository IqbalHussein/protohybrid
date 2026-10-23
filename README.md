# ProtoHybrid

A training planner for people who lift and run. Most apps handle one or the other; this one puts both on the same weekly calendar so you can see when a heavy leg day lands the night before a tempo run.

It's a personal tool for now. The full spec lives in `project-spec.md`, with per-feature specs in `specs/`.

## What it does

- **Weekly calendar.** Plan runs and lifts, drag them around, mark them done or skipped. Your Google Calendar commitments show up as busy blocks, and you can add your own by hand.
- **Lift logger.** Sets, reps, weight and RPE, plus a rest timer, supersets, routines, PR tracking and progress charts. 876 exercises come built in, and you can add your own.
- **Strava sync.** Finished runs fill in the matching planned session (distance, pace, heart rate, elevation). A run you didn't plan is added as an ad-hoc session.
- **Conflict warnings.** Rules like "no hard sessions back to back" or "at least 24h between heavy legs and a hard run". You can change every threshold in Settings.

## Running it locally

Built with Next.js (App Router, TypeScript, Tailwind) and Supabase.

```bash
npm install
cp .env.local.example .env.local   # then fill in the Supabase URL and anon key
npm run dev
```

Apply the SQL files in `supabase/migrations/` in filename order, either with the Supabase CLI or by pasting each one into the SQL editor. Sign-in is email and password, so create your user in the Supabase dashboard under Authentication.

Tests:

```bash
npm test          # training logic: volume, PRs, week math, conflict rules, sync
npm run test:db   # needs Docker: runs every migration against a throwaway Postgres
```

`test:db` checks constraints, triggers and RLS as a signed-in user, not as the table owner, because RLS doesn't apply to the owner. It never touches your real project.

## Integrations

Both are optional and read-only. Leave the keys blank and Settings will tell you they aren't set up.

**Strava.** Create an app at <https://www.strava.com/settings/api>, set its callback domain to your host (`localhost` for development), and fill in `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`. The first sync goes back 30 days. After that, each sync re-reads the three days before the last one, so edits you make on Strava come through.

**Google Calendar.** In Google Cloud, enable the Calendar API, add the `calendar.readonly` scope to the consent screen (and add yourself as a test user), then create a *Web application* OAuth client with `http://localhost:3000/api/auth/google/callback` as a redirect URI. Fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`. Only timed events marked busy come through. All-day, free and declined events are skipped.

Connect both from **Settings**. They sync when you connect, whenever you press **Sync now**, and on their own once background sync is set up.

### Background sync

You'll need a deployed app with a public URL. Set `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `STRAVA_WEBHOOK_VERIFY_TOKEN`.

- `vercel.json` hits `/api/cron/sync` once a day, which is the most Vercel's Hobby plan allows. On other hosts, have any scheduler send a `GET` to that path with `Authorization: Bearer $CRON_SECRET`.
- For runs to show up within minutes, register the Strava webhook once after you deploy:

  ```bash
  curl -X POST https://www.strava.com/api/v3/push_subscriptions \
    -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
    -F callback_url=https://<your-domain>/api/webhooks/strava \
    -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
  ```

The service-role key skips RLS, so every query in background sync filters by user explicitly.

## Where things live

```
src/app/              Pages, server actions, OAuth and cron routes
src/components/       UI (only the calendar grid, rest timer and charts run client-side)
src/lib/lift/         Logger logic: volume, PRs, supersets, routines
src/lib/calendar/     Grid layout, run maths, training load, conflict rules
src/lib/integrations/ Strava and Google sync
supabase/migrations/  Schema, applied in filename order
supabase/tests/       Migration checks used by npm run test:db
```

The time zone is hard-coded as `APP_TIME_ZONE` in `src/lib/time.ts`. That's fine while there's only one user, and it's the one place to change when there are more.
