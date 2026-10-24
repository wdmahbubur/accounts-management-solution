# Scanner response lifecycle — 24 October 2026

Implementation **`8a30c2e65ce6acd84efb01c39b86ea6eed0adde7`**, focused follow-up to private evidence #27 / S-16, stacked on PR #191. No migration, ledger or permission grant changes.

The real private-store/ClamAV run left a harmless file pending with `SCAN_PROTOCOL_ERROR`; quarantine correctly denied its download. A separate asynchronous TCP probe reproduced the cause without customer data: the adapter half-closed its request before the scanner returned a delayed verdict. Immediate mock replies had hidden that race.

The client now sends the framed command and zero-length INSTREAM terminator, keeps its request connection open, and reads the complete bounded reply until the daemon finishes. This follows the [official protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html). A clean prefix followed by another record, non-ASCII bytes, incomplete responses and oversized responses cannot become clean verdicts. A 20-second overall deadline also prevents trickled bytes from extending the existing inactivity timeout indefinitely. Errors continue through the existing lease/backoff path; no operator-generated clean decision is added.

| Check | Actual result |
| --- | --- |
| Delayed asynchronous TCP probe | Before: `SCAN_PROTOCOL_ERROR` / incomplete response. After: `clean` |
| Application suite | **356/356 passed**, no skips, including delayed/fragmented replies, trailing-record rejection, non-ASCII rejection and the real 20-second deadline under trickled bytes |
| Actual ClamAV/private-object suite | **5/5 passed**, no skips, at `8a30c2e`; genuine private upload quarantine, clean release, harmless standard EICAR rejection, cross-company/private-function denial and outage backoff |
| Static checks | `npm run lint` and `npm run typecheck`: passed |

Exact commands:

```text
npm test
npm run lint
npm run typecheck
AMS_SCANNER_TESTS=real-clamav CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=3311 node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/attachment-scanner.test.mjs
node --conditions=react-server output/launch/2026-10-24/scanner-delayed-probe.mjs
```

PowerShell used separate `$env:…` assignments. The test targets the isolated `ams_clean_launch_20261021` database and private `ams-recovery-drill` bucket. The daemon binds **127.0.0.1:3311** only. ClamAV **1.5.4** is listed as current on the [official downloads page](https://www.clamav.net/downloads); the actual `freshclam` update loaded signature revision **28162**. No endpoint protection was disabled. EICAR bytes are synthetic test input, not customer evidence or an executable malware sample.

The [receipts](evidence/scanner-response-2026-10-24/README.md) preserve the failing real run, deterministic before/after probe, accepted real run, signature update and final application/static results. Passing this adapter check does not establish production hosting, private connectivity, scheduling, signature maintenance ownership or incident handling. The production worker host is a pending owner choice; production remains unchanged. Edge also revealed that saved drafts lack an attachment upload control; that workflow and its upload preflight need a subsequent focused fix before claiming browser upload completion. No completed Edge upload/download is claimed here.

Paid billing and privileged support access remain deferred. This candidate is not a worldwide accounting/security certification, a load benchmark or a replacement for independent review. Application rollback must preserve committed financial history; do not restore old books to revert a scanner client.
