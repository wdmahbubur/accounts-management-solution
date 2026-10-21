# Release verification follow-up - 21 October 2026

This follows PR #185 at `759b298590366ca3c24e3325a166a25477875d15`. It uses the same isolated Neon `ams_clean_launch_20261021` database and private test bucket. Production remains outside this evidence. Synthetic users, companies and documents are used throughout.

## Changes

Migrations **0116-0117** add immutable, organization-scoped cash-flow finalization evidence. A permitted, recently authenticated user reviews a material digest; the database takes the posting/close lock order, re-reads the report and rejects changed, provisional or unreconciled results. Same-key replay and different-key races return one saved snapshot and audit event. Later postings do not overwrite reviewed evidence. Finalization does not lock periods or certify statutory books. The selected finalized JSON download retains that saved cutoff.

Report PDFs now present named totals and account/statement detail instead of raw snapshot property paths and internal IDs. Exact money remains text; expenses use the same display direction as the screen. Existing CSV/XLSX snapshots and already-issued files are unchanged. Bengali text, long unspaced references, pagination and page numbers were checked. New bill/paid-expense lines require an explicit expense/asset account selection instead of defaulting to Cash on hand.

Edge exposed an absent `request_report_export` entry in the application RPC allowlist. Database export tests alone had missed the broken browser request. The missing command is now registered, uncertain client retries retain their request key/body, and the real authenticated HTTP suite includes export creation/replay plus selected cash-flow finalization/download. Temporary membership-query failures now surface as loading failures instead of being converted into a false empty directory or revoked-membership result. Authorization denials remain masked.

Migrations **0118-0119** fix two read-model omissions found in Edge: allocation/unapply evidence now links the receipt/payment to its opposite source document, and the journal register includes all posted source types instead of manual journals only. They replace read functions without changing journals, allocations or issued snapshots. Edge shows all six golden journals and the invoice drilldown works.

## Verification

| Check | Exact command / procedure | Result |
| --- | --- | --- |
| Cash-flow finalization | `node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/cash-flow-finalization.test.mjs` | 4/4 passed, no skips; races, stale review, quarantine of unclassified activity, permission denial and immutable historical evidence |
| Real scanner | `AMS_SCANNER_TESTS=real-clamav`, loopback `CLAMAV_HOST`/port, then `node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/attachment-scanner.test.mjs` | 5/5 passed, no skips, ClamAV 1.5.4 / signatures 28160; real private uploads, clean release, EICAR rejection, tenant denial and outage backoff |
| Private report exports | `node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/export-acceptance.test.mjs` | 6/6 passed, no skips; original cutoff despite later posting, actual CSV/PDF/XLSX and revoked-requester denial |
| Real authenticated HTTP | `AMS_TEST_APP_URL=http://localhost:3001`, then `node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/http-security.test.mjs` | 7/7 passed, no skips; three separate password-authenticated users, actual export replay and finalized JSON download |
| Golden browser books | Six synthetic source commands in Edge; restricted runtime report/journal readback | Bank 102,000; AR 4,000; AP 1,000; profit 5,000; assets 106,000; financing 100,000; operating 2,000; six balanced source journals |
| Golden regression after 0118-0119 | `node --env-file=<private-isolated-profile> --conditions=react-server --test tests/database/golden-books.test.mjs` | 10/10 passed, no skips, including all-source register, allocation/unapply counterpart links and ordinary-role report denial |
| Application checks | `npm run lint`; `npm run typecheck`; `npm test`; `node --env-file=<private-isolated-profile> scripts/run-next.mjs build apps/web --webpack` | Passed; 341 application tests, no skips, optimized compile and TypeScript check |
| PDF inspection | Private bytes independently read and checked with pdfplumber, Poppler render and visual review | Correct original net profit 100.00; readable labels; one-page real export; five-page bilingual/long-token stress render, all five page numbers and zero out-of-bounds characters |

The final static/build receipts and Edge observations are recorded in the [evidence index](evidence/release-verification-2026-10-21/README.md). Exploratory failures are not passes: PostgreSQL exposed ambiguous JSONB operator precedence in 0116 (forward repair 0117); the PDF renderer needed the existing `profit_loss` snapshot alias; an initial page-number placement added blank pages (corrected and re-rendered); the HTTP test originally compared two different capture timestamps (corrected to compare the actual saved finalization). Applied migration receipts and posted accounting facts were never edited to satisfy tests.

## Release decisions

The source-case matrix is **69 covered, 1 partial (consented support access), 2 explicitly deferred (paid billing)**. Deferred is an owner scope decision, never a passing result. Edge verified the dashboard, P&L, balance sheet, cash flow/finalization, GL, cashbook, AR/AP aging, both statements, trial balance, all-source journal register and invoice drilldown. After switching to empty Golden beta, browser history and an old Golden alpha dashboard URL require reopening the correct company and disclose no alpha totals in beta.

The user explicitly deferred paid billing and requested a provider adapter. Approved paid plans and limits will be supplied later. No prices, plan limits, trial, grace period or free-pilot promise were invented. Paid-provider lifecycle cases T-45/T-46 remain unverified/deferred; deferral is not a successful billing test.

The real scanner run resolves the missing engine integration evidence. Production still needs an approved protected worker/scanner topology, scheduler, signature updates and incident ownership; a developer's loopback daemon is not production infrastructure. See the [scanner runbook](../operations/attachment-scanner.md).

The earlier database/object recovery drills remain documented in PR #183 and the PR #185 candidate follow-up. They predate the new finalization table and do not claim that this latest candidate has been restored, or promise a production RTO/RPO. Repeat the integrated candidate drill before final release. Current local browser testing uses `next dev`; the earlier automatic approval review rejected `next start` as blocked by policy, and no equivalent start was retried.

This remains the approved BDT-only accrual scope for Bangladesh service/non-stock SMEs. Worldwide access is not worldwide tax/currency certification. Independent accountant/owner review, consented support-access controls, the declared 100-company performance test, production worker/backup operations, retention/commercial decisions, pilots, and separate production migration/deployment authorization remain release gates. No human approval or provider verification is manufactured by these engineering checks.
