#!/usr/bin/env bash
set -euo pipefail

DB_URL="${SUPABASE_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
LOCK_KEY=5005005
HOLDER_LOG="$(mktemp)"
trap 'rm -f "$HOLDER_LOG"' EXIT

psql "$DB_URL" -Atqc "
  select pg_backend_pid();
  select pg_advisory_lock($LOCK_KEY);
  select pg_sleep(2);
  select pg_advisory_unlock($LOCK_KEY);
" >"$HOLDER_LOG" &
holder_process=$!

sleep 0.5

contender_pid="$(psql "$DB_URL" -Atqc 'select pg_backend_pid();')"
contended="$(psql "$DB_URL" -Atqc "select pg_try_advisory_lock($LOCK_KEY);")"

if [ "$contended" != "f" ]; then
  echo "Expected the second independent connection to observe advisory-lock contention."
  exit 1
fi

wait "$holder_process"
holder_pid="$(head -n 1 "$HOLDER_LOG")"

if [ -z "$holder_pid" ] || [ "$holder_pid" = "$contender_pid" ]; then
  echo "Expected distinct PostgreSQL backend PIDs."
  exit 1
fi

available_after_release="$(psql "$DB_URL" -Atqc "select pg_try_advisory_lock($LOCK_KEY);")"
if [ "$available_after_release" != "t" ]; then
  echo "Expected advisory lock to become available after the holder committed/released."
  exit 1
fi

echo "US-005 independent multi-connection race harness PASS (holder=$holder_pid contender=$contender_pid)"
