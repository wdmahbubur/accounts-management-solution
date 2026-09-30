#!/usr/bin/env bash
set -euo pipefail

project_id="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml | head -n 1)"
if [ -z "$project_id" ]; then
  echo "Could not resolve Supabase project_id from supabase/config.toml"
  exit 1
fi

for attempt in 1 2 3; do
  echo "Starting isolated Supabase database (attempt $attempt/3)..."

  supabase stop --no-backup >/dev/null 2>&1 || true

  stale_ids="$(docker ps -aq --filter "name=supabase_db_${project_id}")"
  if [ -n "$stale_ids" ]; then
    docker rm -f $stale_ids >/dev/null 2>&1 || true
  fi

  if supabase db start; then
    exit 0
  fi

  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 4))
  fi
done

echo "Failed to start isolated Supabase database after bounded retries."
exit 1
