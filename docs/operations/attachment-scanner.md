# Private attachment scanning

Uploads remain quarantined until the restricted scanner worker records a clean engine decision. Scanner failures are retried with a lease and backoff; they must never be converted into a clean result by an operator. Rejected objects cannot be downloaded through the application.

Use an official maintained [ClamAV distribution](https://www.clamav.net/downloads) and keep its signature database updated with `freshclam`. Follow the vendor's [configuration guide](https://docs.clamav.net/manual/Usage/Configuration.html). `StreamMaxLength` must permit the application's 10 MiB input limit. Bind `clamd` to loopback on the worker host. Its native TCP protocol has no authentication or transport encryption; never expose it to the public internet or send private company evidence over an unprotected connection.

The worker needs `DATABASE_WORKER_URL` using `ams_job_worker_login`, private object-store credentials, `CLAMAV_HOST` and `CLAMAV_PORT`. The application runtime must remain a separate restricted role. A local engine on a developer's machine is not reachable as `127.0.0.1` from a Vercel function. Production needs an approved worker/scanner hosting topology, scheduler, signature-update schedule and incident owner before scanning can be advertised as operational.

The existing authenticated `POST /api/internal/attachments/scan` processes at most ten jobs. Its bearer secret is `ATTACHMENT_SCAN_WORKER_SECRET` (at least 32 characters). Keep it server-side. An unauthorized caller receives 503 and does not start a scan. Schedule only after the worker can reach both the private objects and protected scanner. Alert on pending age, retry/failure counts and outdated signature revisions; an HTTP 200 alone is not proof that every attachment was scanned.

For an isolated real-engine check, load a private test profile explicitly, set `AMS_SCANNER_TESTS=real-clamav`, `CLAMAV_HOST=127.0.0.1` and the local port, then run:

```text
node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/attachment-scanner.test.mjs
```

The test refuses a non-test bucket or non-loopback scanner. It uploads synthetic clean text and the harmless standard EICAR antivirus test string to the private test store, exercises the actual ClamAV protocol/worker, checks quarantine, engine revision, tenant denial and outage backoff, and never posts financial activity. Endpoint protection may independently recognize the EICAR test; do not disable it. Preserve engine/signature and test receipts, not credentials or object bytes, in public evidence.

The 21 October 2026 isolated run passed against ClamAV 1.5.4/signature revision 28160. This verifies the engine integration, not production hosting, retention, monitoring or service-level commitments.

The [24 October follow-up](../qa/scanner-response-lifecycle-2026-10-24.md) fixes the client's premature TCP half-close and validates complete responses with an overall 20-second deadline. Its real private-store/EICAR run passes on signature revision 28162. Keep the daemon connection private and use the existing retry/quarantine state when the engine is unavailable; this client repair does not provision a production worker.
