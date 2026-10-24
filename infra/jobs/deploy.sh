#!/bin/sh
set -eu
# Run only after separately authorizing production activation. This project
# never references NextGenPOS containers, networks, databases or volumes.
cd /opt/ams-jobs
test "$(awk '/MemTotal:/{print $2}' /proc/meminfo)" -ge 7500000 || {
  echo 'Refusing activation: this shared host needs an approved 8 GiB+ memory allocation.' >&2
  exit 1
}
test -f .env
for kind in mail exports scanner reminders; do
  test -f "secrets/$kind.env"
  test "$(stat -c %a "secrets/$kind.env")" = 400
  test "$(stat -c %u "secrets/$kind.env")" = 1000
done
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d --wait --wait-timeout 300
docker compose --env-file .env -f compose.yml ps
