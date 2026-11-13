# ProtoHybrid

Web app for hybrid athletes (lifters who also run) to plan and track both disciplines as one training load. See `project-spec.md` for the product spec.

Live: https://protohybrid.vercel.app

## Stack

Next.js 15 (App Router, Server Actions, TypeScript, Tailwind 3) and Supabase (Postgres, magic-link auth, RLS). Deployed on Vercel. Node 22 or later.

## Features

- **Week** (`/week`): plan runs and lifts Mon–Sun, drag to reschedule (or use Move on a card), planned vs actual, busy time from Google Calendar or added by hand, and conflict warnings. The load strip at the top shows each day's minutes.
- **Lifts** (`/lifts`): log sets against the exercise library (plus custom exercises), start from routines, a per-exercise rest timer, and history and PRs per exercise.
- **Runs** (`/runs`): log runs, complete planned runs, and compare target vs actual.
- **Settings**: conflict rules, Google Calendar, manual busy time, and lb/kg.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase > Settings > API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Google Cloud OAuth client (see below). Without them, Settings says Google isn't set up. |
| `SITE_URL` | No | Overrides the origin used in magic links. On Vercel production the project's production URL is used automatically. |

### Supabase auth

In Supabase > Authentication > URL Configuration:

- Site URL: your deployed URL.
- Redirect URLs: `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`. Use exact URLs, not wildcards.

### Google Calendar (optional)

1. In Google Cloud, enable the **Google Calendar API**.
2. OAuth consent screen: add scopes `openid`, `email` and `.../auth/calendar.readonly`. While the app is in testing, add yourself as a test user.
3. Credentials > OAuth client ID > **Web application**, with these authorized redirect URIs:
   - `http://localhost:3000/api/auth/google/callback`
   - `https://<your-domain>/api/auth/google/callback`
4. Put the client ID and secret in `.env.local`, and in Vercel for Production and Development.

Sync reads the primary calendar from 14 days back to 56 days ahead. It keeps timed events that make you busy, and skips all-day, cancelled, "free" and declined events. Synced events that disappear from Google are removed. Disconnecting revokes access and deletes the synced events.

## Database

**The live Supabase database is the source of truth, not `0001_init.sql`.** The live schema was changed outside these migrations at some point (exercise library, routines, PRs, OAuth connections, and more). `supabase/tests/live_schema.sql` is a replica of it, rebuilt from a catalog dump on 2026-11-03 (after `0002` was applied).

| Migration | Status |
| --- | --- |
| `0001_init.sql` | Historical. Don't run it. |
| `0002_manual_run_log.sql` | Applied. Included in the replica. |
| `0003_full_app.sql` | Applied 2026-11-03. Strava cleanup, the `weight_unit` setting, and every RPC the app calls. |

Data rules worth knowing:

- **Ownership:** every table has row-level security keyed to `auth.uid()`. Multi-table writes go through `security invoker` functions in `0003`, so they run under the caller's RLS. Those functions also check that referenced rows (routines, exercises) are visible to the caller, because foreign keys bypass RLS.
- **Weights:** lift weights are stored in **lb**. The kg setting converts for display and entry. Editing a lift without changing a weight keeps the stored value exactly.
- **PRs:** `personal_records` is rebuilt in date order for the affected exercises whenever a lift is logged, edited, moved, skipped or deleted. Only working and to-failure sets count.
- **Time zones:** dates are local calendar dates. The browser's time zone is kept in a `tz` cookie (UTC until it's set), and busy blocks are stored as UTC instants.

### Changing the schema

1. Write `supabase/migrations/000N_*.sql` so it is safe to re-run: `if not exists`, `create or replace`, and guarded `do` blocks.
2. Make `scripts/test-db.mjs` apply it, and add checks for the new behaviour, including RLS as a second user.
3. Run `npm run test:db` until it passes.
4. Apply the file in the Supabase SQL Editor, then deploy the app.
5. If the live schema changed in a way the migration doesn't capture, update `supabase/tests/live_schema.sql`.

## Tests

```bash
npm run check     # typecheck + lint + unit tests + database tests (what CI runs, minus the build)
npm test          # unit tests only (Vitest)
npm run test:db   # database tests only (PGlite)
```

**Unit tests (Vitest)** live next to the code as `*.test.ts`:

| Area | What's covered |
| --- | --- |
| `src/lib` | Time zones and DST, week maths, units, run parsing and formatting, lift and routine form parsing, e1RM and volume, the conflict engine (every rule type, thresholds, week boundaries), Google event filtering, token refresh, pagination, sync pruning, disconnect, settings helpers |
| Server actions (`src/app/(app)/**/actions.test.ts`) | Form validation and messages, the exact RPC or table call made, unit conversion on save, error handling, revalidation |
| Routes and middleware | Google OAuth start and callback (CSRF state, denied consent, missing scope, keeping the refresh token), the magic-link callback, and the sign-in redirects |
| Week data | Splitting busy blocks across local midnight, mapping session rows, seeding default rules |

Server code is tested against `src/test/fake-supabase.ts`, a stand-in client that records every query and returns scripted results. Mock `@/lib/auth`, `next/cache` and `next/navigation` with `vi.mock` as the existing action tests do.

**Database tests (`scripts/test-db.mjs`)** load the live-schema replica into PGlite (Postgres compiled to WASM, in-process), add data shaped like production, and apply `0003` twice. They then run every RPC as two users, covering:

- happy paths
- validation, with nothing written on failure
- PR chronology after edits, backdating, skips and deletes
- cross-week rescheduling
- RLS isolation on every table the app writes
- re-applying the migration over existing data

**Not covered automatically:** React components and the browser flows (drag and drop, dialogs, the rest timer). After UI changes, click through the week, lift and run flows on a preview or production deploy.

## CI and deploy

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, database tests and a production build on every push to `main` and on every pull request.

Deploys go through the Vercel CLI from a linked checkout:

```bash
npx vercel deploy --prod
```

Apply any new migration before deploying code that depends on it.

## Structure

```
src/app/(app)/          Signed-in pages: week, lifts, runs, settings (each with actions.ts)
src/app/login, auth/    Magic-link sign-in and callback
src/app/api/auth/google Google Calendar OAuth start and callback
src/middleware.ts       Session refresh and the sign-in redirect
src/components/ui/      Design-system primitives (Button, Field, Panel, Dialog, ...)
src/lib/                Shared logic: types, time, units, runs, lifts, conflicts, google, settings
src/test/               Test helpers (fake Supabase client)
supabase/migrations/    SQL migrations
supabase/tests/         Live-schema replica used by the database tests
scripts/test-db.mjs     Database test suite
```

## Design

The tokens are in `tailwind.config.ts`:

- **Surfaces and text:** true-black surfaces (`ink`) and off-white text (`chalk`).
- **Colours:** blue (`run`) marks runs, orange (`lift`) marks lifts, and conflicts are drawn in inverted chalk so they never read as lift orange.
- **Session states:** planned sessions are outlined, completed ones are solid, and skipped ones are struck through.
- **Type:** Archivo, using its width axis (`stretch-wide`, `stretch-semi`) for headings.
- **Contrast:** text and controls meet WCAG AA on black.
