# ProtoHybrid

Web app for hybrid athletes (lifters who also run) to plan and track both disciplines as one integrated training load. See `project-spec.md` for the full spec.

## Stack

Next.js (App Router, TypeScript, Tailwind) + Supabase (Postgres, auth-ready).

## Getting started

This scaffold was hand-written (no `node_modules`, no lockfile yet) — install dependencies before running anything:

```bash
npm install
```

Copy the env file and fill in your Supabase project keys:

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from your Supabase project's Settings > API
- `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` — not needed until Strava sync (Next Steps #5)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — you already have the Google Cloud project; add these when wiring up Calendar sync (Next Steps #6)

Apply the database schema (`supabase/migrations/0001_init.sql`) via the Supabase CLI or by pasting it into the SQL editor in your Supabase project dashboard.

Run the dev server:

```bash
npm run dev
```

## Project status

Scaffold + initial schema are done (Next Steps #1–#2 in `project-spec.md`). Remaining work — lift logger, weekly calendar, Strava sync, Google Calendar sync, conflict-check logic — is best done iteratively with a real dev server and terminal access, e.g. by opening Claude Code in this directory.

## Structure

```
src/app/            Next.js App Router pages
src/lib/supabase/   Supabase client (browser) and server client helpers
supabase/migrations/ SQL schema
project-spec.md      Full project spec
```
