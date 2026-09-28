#!/usr/bin/env bash
#
# Apply supabase/migrations/ to a throwaway Postgres and assert the schema
# behaves — constraints, triggers and the RLS policies.
#
# The real project is never touched: this spins up a container, runs everything
# against it, and removes it again. Supabase's auth schema, auth.uid() and the
# `authenticated` role are stubbed in supabase/tests/00_supabase_stub.sql.
#
# Usage: ./scripts/check-migrations.sh    (needs Docker running)

set -euo pipefail

CONTAINER=protohybrid-migration-check
IMAGE=postgres:16-alpine
DB=protohybrid_test
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

cleanup
echo "Starting $IMAGE..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB="$DB" "$IMAGE" >/dev/null

# The image first runs a temporary server for initialisation, listening on the
# Unix socket only, then shuts it down and starts the real one. Waiting on the
# socket can catch the temporary server just before it stops; only the real
# server listens on TCP, so wait for that.
ready=
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U postgres -d "$DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "Postgres did not become ready in 60s." >&2
  docker logs "$CONTAINER" >&2 || true
  exit 1
fi

docker cp "$ROOT/supabase/migrations" "$CONTAINER:/tmp/migrations" >/dev/null
docker cp "$ROOT/supabase/tests" "$CONTAINER:/tmp/tests" >/dev/null

run() { docker exec "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"; }

echo
echo "Applying migrations"
run /tmp/tests/00_supabase_stub.sql
for file in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  run "/tmp/migrations/$name"
  echo "  ok  $name"
done
run /tmp/tests/01_grants.sql

echo
echo "Asserting behaviour"
for file in "$ROOT"/supabase/tests/0[2-9]*.sql; do
  name="$(basename "$file")"
  echo "  $name"
  # psql prints NOTICEs to stderr; the prefix is noise in a test report.
  run "/tmp/tests/$name" 2>&1 | sed -E 's/^psql:[^ ]+ //; s/^(NOTICE|WARNING):  /    /' || {
    echo "FAILED: $name" >&2
    exit 1
  }
done

echo
echo "All migration checks passed."
