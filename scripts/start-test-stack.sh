#!/usr/bin/env bash
set -euo pipefail

for attempt in 1 2 3; do
  echo "Starting full isolated Supabase stack (attempt $attempt/3)..."
  supabase stop --no-backup >/dev/null 2>&1 || true

  if supabase start; then
    exit 0
  fi

  if [ "$attempt" -lt 3 ]; then
    sleep $((attempt * 5))
  fi
done

echo "Failed to start full isolated Supabase stack after bounded retries."
exit 1
