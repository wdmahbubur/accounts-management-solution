# Mail recipient parser patch — 24 October 2026

Implementation `7d4f5db8806fd1cdc7cf0d7b8b867311ce575996`, stacked on PR #193. No database migration or production change.

Nodemailer 10.0.13 was affected by recipient-parsing advisories involving [nested comments](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [quoted/comment group terminators](https://github.com/advisories/GHSA-m943-m63m-w62w) and [quoted local parts](https://github.com/advisories/GHSA-85x2-q946-cp5h). The pinned dependency and lockfile now use the maintainer's [10.2.1 release](https://github.com/nodemailer/nodemailer/releases/tag/v10.2.1). This is a dependency finding, not evidence that this application was exploited.

The regression uses the installed sender's real parser and nonnetwork JSON transport with synthetic addresses. It asserts the exact parsed mailbox and a single SMTP-envelope recipient at the intended domain. SMTP envelope sanitization of angle characters is distinguished from address-parser preservation. No messages are sent externally by this test.

| Check | Actual result |
| --- | --- |
| Application suite | 365/365 passed, no skips |
| `npm audit --omit=dev --json` | Zero known production dependency vulnerabilities |
| Lint and TypeScript | Passed |
| Verification-token suite | 4/4 passed: cooldown, consumption/replay, expiry/purpose separation and four independent issuance processes |
| Worker recovery suite | 4/4 passed: injected PDF failure, missing issued object restored to loopback SMTP, genuine process kill/lease expiry/reclaim with stale-token denial; financial facts unchanged |
| Restricted outbox claim suite | 4/4 passed with a fresh synthetic posted invoice and real private PDF |
| Optimized build | Attached build receipt |

Exact commands:

```text
npm install --workspace @ams/web --save-exact nodemailer@10.2.1
npm run test:application
npm audit --omit=dev --json
npm run lint
npm run typecheck
node --env-file=<private-isolated-profile> --conditions=react-server --test --test-concurrency=2 tests/database/worker-recovery.test.mjs tests/database/identity-verification.test.mjs tests/database/outbox-claim.test.mjs
node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/outbox-claim.test.mjs
node --env-file=<private-isolated-profile> scripts/run-next.mjs build apps/web --webpack
```

The first combined integration run reports **8 passed / 1 failed**: its historical outbox fixture required a specific 20 October browser account and stopped before exercising its claim assertions. That failure is retained. The repaired test uses the normal fixture, posting and PDF services; it does not manufacture an issued version or relax isolation guards. It also checks the worker host/database directly instead of rewriting them, and scopes unchanged-financial-fact fingerprints to its own unique company so independent fixtures do not create false mismatches. Its subsequent **4/4** result replaces that failed test. Initial application runs failed due to monorepo module resolution and then an overly literal SMTP local-part expectation; both were corrected before the final 365/365 run.

The isolated database/private bucket guards remain active. Worker recovery restores only its own synthetic object bytes, waits for actual lease expiry and delivers to loopback SMTP. It is not a provider inbox receipt or a new full provider database/file restore drill. The local development server was restarted with the updated dependency. Production mail delivery, hosting/scheduling, separate deployment authorization and independent review remain outside this patch. Billing and support access remain deferred.

[Logs and receipts](evidence/mail-parser-2026-10-24/README.md) record the precise pass/fail boundaries. No marketing certification or whole-product launch acceptance is implied.
