# ProtoHybrid

Web app for hybrid athletes (lifters who also run) to plan and track both disciplines as one integrated training load. See `project-spec.md` for the full spec.

Live: https://protohybrid.vercel.app

## Stack

Next.js 15 (App Router, TypeScript, Tailwind) + Supabase (Postgres, magic-link auth, RLS). Deployed on Vercel.

## Features

- **Week** (`/week`): plan runs and lifts Mon–Sun, drag to reschedule, planned vs actual, busy blocks from Google Calendar or added by hand, and conflict warnings. A load strip at the top shows each day's planned minutes.
- **Lifts** (`/lifts`): log sets against an exercise library (with custom exercises), routines, a per-exercise rest timer, and history plus PRs per exercise.
- **Runs** (`/runs`): log runs manually, complete planned runs, and compare target vs actual.
- **Settings**: conflict rules, Google Calendar connection, busy blocks, and lb/kg.

## Getting started

```bash
npm install
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`: from Supabase > Settings > API.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: optional. These are OAuth credentials for Calendar sync. In Google Cloud, register these redirect URIs: `http://localhost:3000/api/auth/google/callback` and `https://<your-domain>/api/auth/google/callback`.

Sign-in uses Supabase email magic links. In Supabase > Authentication > URL Configuration, set the Site URL to your deployed URL. Then add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to Redirect URLs.

```bash
npm run dev
```

## Database

**The live database is the source of truth, not `0001_init.sql`.** The live schema was changed outside these migrations at some point (an exercise library, routines, PRs, OAuth connections, and more). `supabase/tests/live_schema.sql` is a replica of it, rebuilt from a catalog dump on 2026-11-03.

- `0001_init.sql` is historical. Don't re-run it.
- `0002_manual_run_log.sql` and `0003_full_app.sql` were written against the live schema and are safe to re-run. Apply them in the Supabase SQL editor.
- The built-in exercise library (876 rows) lives only in the live database.

Lift weights are stored in **lb**. The kg setting converts for display and entry.

## Tests

```bash
npm test          # Vitest: date/time, units, durations, conflict engine, lift and Google helpers
npm run test:db   # Applies 0003 to the live-schema replica in PGlite and exercises every RPC
```

Run `npm run test:db` before applying any new migration to Supabase.

## Structure

```
src/app/(app)/          Signed-in pages: week, lifts, runs, settings
src/app/login, auth/    Magic-link sign-in
src/app/api/auth/google Google Calendar OAuth
src/components/ui/      Design-system primitives (Button, Field, Panel, Dialog, ...)
src/lib/                Shared logic: types, time zones, units, conflicts, lifts, google
supabase/migrations/    SQL migrations
supabase/tests/         Live-schema replica for migration tests
scripts/test-db.mjs     PGlite migration test suite
```
