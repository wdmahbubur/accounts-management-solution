#!/bin/sh
set -eu
# Separate production activation authorization is required. No ClamAV daemon,
# POS service, mail/export worker, host resize or public listener is started.
cd /opt/ams-cloud-scanner
test "$(awk '/MemAvailable:/{print $2}' /proc/meminfo)" -ge 327680 || {
  echo 'Refusing activation: cloud scanner needs 192 MiB plus 128 MiB available headroom.' >&2
  exit 1
}
test -f .env
test "$(stat -c %a secrets/scanner.env)" = 400
test "$(stat -c %u secrets/scanner.env)" = 1000
grep -qx 'ATTACHMENT_SCAN_PROVIDER=bouncer' secrets/scanner.env
docker compose --env-file .env -f compose.bouncer.yml config --quiet
docker compose --env-file .env -f compose.bouncer.yml up -d --wait --wait-timeout 180
docker compose --env-file .env -f compose.bouncer.yml ps
