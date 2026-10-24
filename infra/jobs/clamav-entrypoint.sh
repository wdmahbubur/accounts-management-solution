#!/bin/sh
set -eu
# The vendor entrypoint starts FreshClam and clamd concurrently. A bundled old
# engine may otherwise remain loaded until its next self-check, despite a
# successful initial update. Complete the verified update before loading it.
install -d -g clamav -m 775 -o clamav /run/clamav
chown -R clamav:clamav /var/lib/clamav
freshclam --stdout --user=clamav
exec /bin/sh /init
