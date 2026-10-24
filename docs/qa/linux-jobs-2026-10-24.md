# Isolated Linux background jobs — 24 October 2026

Implementation **ffb3bd63361ce9cb710327aaa860b9897538f182**; generated test-credential follow-up **f79bf6b**. PR #197, based on #196. Scope #88/#89/#27/#99. No schema change. **Production activation is deferred at the user's explicit request until server capacity is arranged.** Billing and privileged support remain deferred.

The user selected the existing NextGenPOS Linux server. Read-only inspection found approximately 896 MiB total and 353 MiB available RAM, with the existing POS/Redis services healthy. That cannot host a full ClamAV engine safely. The prepared isolated Compose project requires an approved 8 GiB+ shared-host allocation before activation; the production host, services, environment and data remain unchanged. No Azure resize, paid Cloudflare upgrade, production credential transfer or deployment occurred.

The image reuses the existing leased database jobs. Each process claims one job per cycle, never overlaps its own batches, stops new claims on termination and allows the current batch to drain. A 90-second hard process deadline precedes the shortest 120-second lease. Database expiry/token fencing recovers interrupted work; financial posting is never retried by these workers. SMTP acknowledgements can be ambiguous after connection loss, so delivery remains at-least-once with stable Message-ID, not a promise of exactly-once recipient receipt.

A dedicated worker uses the existing restricted worker login and a credential-free target reference. Owner/migration/runtime/auth credentials are rejected before claiming. Separate read-only secret mounts avoid Docker environment metadata; image/context exclude local environments, keys and operational output. Containers run as non-root, read-only, without capabilities or published ports. The scanner's daemon is restricted to the separate jobs network. Production definitions include bounded memory/CPU/process/log budgets; these are not proof of capacity at the worldwide workload.

The real Linux test found that the vendor image started clamd using bundled signature revision **28157** (18 October) while FreshClam updated the disk. Its early notification failed because the daemon socket was not ready, leaving the older loaded engine until self-check. The new freshness check correctly refused release. The wrapper now completes the verified update before loading clamd; the successful Linux run loads **28163** (24 October). New scans refuse invalid dates, signatures older than 72 hours, and future dates beyond 30 minutes. Scanner/daemon use UTC. The prior pending synthetic upload resumed through the ordinary worker after reloading the current engine; quarantine was never bypassed.

| Check | Actual result |
| --- | --- |
| Final real Linux container flow at implementation commit | **4/4 passed**, no skips: SMTP issued-PDF delivery, private PDF report export, real clean scan/download and reminder execution; journals unchanged |
| Real ClamAV/private S3 cases | **5/5 passed** in the initial combined receipt; clean release, EICAR rejection, tenant/quarantine and outage retry |
| Dedicated worker process recovery | **4/4 passed** after matching parent/child canonical origins; real interrupted SMTP process, actual lease expiry, stale-token fencing, identical Message-ID and unchanged journal |
| Application suite | **373/373 passed**, no skips |
| Generated-credential fixture follow-up | **4/4 targeted tests passed** |
| Lint / TypeScript / optimized web build | Passed; receipts attached |
| Image builds | Both pinned official bases and final images built locally; identifiers in `images.json` |

Exact commands:

```text
docker build -f infra/jobs/Dockerfile -t ams-jobs:launch-candidate .
docker build -f infra/jobs/Clamav.Dockerfile -t ams-clamav:launch-candidate .
AMS_JOB_TESTS=isolated-docker AMS_JOBS_TEST_IMAGE=ams-jobs:launch-candidate AMS_CLAMAV_TEST_IMAGE=ams-clamav:launch-candidate node --env-file=<private-fresh-lineage-profile> --conditions=react-server --test tests/database/linux-job-runner.test.mjs
AMS_SCANNER_TESTS=real-clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3311 node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/attachment-scanner.test.mjs tests/database/worker-recovery.test.mjs
node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/worker-recovery.test.mjs
npm test
npm run lint
npm run typecheck
node --env-file=<private-isolated-profile> scripts/run-next.mjs build apps/web --webpack
node --conditions=react-server --test tests/application/background-jobs.test.mjs
```

PowerShell assigned the variables separately. Linux tests require an explicit isolated database with no competing scan/mail/export queue, real restricted-role connections and the private test bucket. SMTP runs inside a disposable private Docker network and accepts only `.invalid` recipients; it is not an external provider/inbox test. The test verifies actual non-root/read-only/capability/network/port/credential metadata, private output hashes and unchanged journals. The separate recovery suite uses an actual loopback SMTP server. Test containers/networks are removed by exact generated names; synthetic database evidence remains intact.

Initial receipts are preserved: an incorrect test import failed before execution; the first complete container run delivered/exported but correctly failed scanning on stale definitions; the first dedicated-process recovery assertion compared different canonical-origin domains, then passed after parent/child configuration matched. A new fixture's timestamp boundary was also made explicit in UTC. GitGuardian identified six hardcoded, reserved `.invalid` PostgreSQL fixture strings in the first commit; the follow-up generates those test values at runtime rather than suppressing the detector or rewriting shared history. No real database credential was in those fixture strings. Verify the current PR security check before merge.

This is labelled AI engineering/security review under #115. It does not establish production activation/alert routing, independent audit, a new full provider database/file restore, measured 100-company/100k-line capacity, or worldwide tax/compliance certification. No new Edge UI flow is claimed by this backend report; the preceding opening/year-close/upload QA records identify their actual browser evidence. [Deployment inputs and remaining operational work](../../infra/jobs/README.md) include health interpretation, resource/secret preflight and rollback constraints. Docker health alone is not proof of all deliveries and does not automatically restart a merely unhealthy process.
