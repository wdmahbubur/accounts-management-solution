FROM clamav/clamav:1.5.4@sha256:e19130cdebaeacc71fa46eab3ed6f69941f2f22aa5e08d55e9197f8edf43ce5e
COPY --chmod=755 infra/jobs/clamav-entrypoint.sh /usr/local/bin/ams-clamav-entrypoint.sh
ENTRYPOINT ["/sbin/tini","--","/usr/local/bin/ams-clamav-entrypoint.sh"]
