# Login, approval evidence and issued PDF regressions — 20 October 2026

Requested scope: repair the three defects found in the Edge signup-to-ledger run,
then repeat the affected browser journeys. Related stories: US-006 (#20),
US-064 (#41) and US-071 (#88). This is a focused repair on top of the open
workspace PR #173; it does not establish completion of their broader acceptance
criteria or the full US-085 suite. PR #120 for the original auth implementation
is merged; the current Neon foundation and approval/workspace stacks remain open.

Implementation tested: `ba4be211cf81c8b9ecf218da50ca167deb6fa3f4`.

## Changes

- Replace the failed-login read/update sequence with one atomic PostgreSQL upsert.
  The first failure counts once, the fifth failure blocks further attempts for
  15 minutes, expired windows reset to one, and failures already in flight cannot
  extend or clear an active lockout. All timing comes from PostgreSQL.
- Display numeric approval policy versions and counts, including list progress.
  Missing/malformed evidence displays an em dash instead of a misleading zero.
- Migration `0099_restore_invoice_pdf_download_authorization.sql` restores the
  invoice-PDF branch removed by migration 0074. It retains that migration's
  attachment and report-export rules and requires live module access, an active
  company, and the exact posted invoice version/digest.
- Parse bounded PostgreSQL bigint byte-count strings in the artifact downloader.
  Exact object keys, byte limits, size/hash integrity and the second live
  authorization check remain enforced. Financial decimal parsing is unchanged.

Schema impact is limited to replacing the private authorization predicate; no
tables, financial facts or PDF metadata are rewritten. Application rollback must
retain the stored PDF metadata/object bytes; this forward-compatible function
repair can remain in place.

## Environment and database evidence

Local Next.js app at `http://localhost:3000`; real Microsoft Edge browser.
Only the disposable Neon branch `e2e-local-20261020` was migrated (0098 → 0099).
The migration runner checked all 98 files. Target-host assertions guarded the
run. Production migration/deployment and external email/payment execution were
not performed. Development uses private local object storage; production S3
configuration and provider integration remain outside this verification.

The isolated branch expires on **21 October 2026, 15:47 Asia/Dhaka**. The private
original environment backup remains ignored locally. No credentials, cookies,
tokens or real customer records are included in this evidence.

| Check | Result |
| --- | --- |
| `npm run lint` | PASS, exit 0 |
| `npm run typecheck` | PASS, exit 0 |
| `npm test` | PASS: 324/324, zero skipped |
| Targeted approval/artifact/PDF application tests | PASS: 9/9 |
| `AMS_DATABASE_TESTS=isolated npm run test:database:login-limiter` | PASS: 5/5 including parent; eight independent app processes |
| `AMS_DATABASE_TESTS=isolated npm run test:database:invoice-pdf` with synthetic fixture variables | PASS: 3/3 including parent |
| `npm run build` | PASS, exit 0; optimized build, TypeScript and all 9 static pages |
| Edge affected E2E journeys | PASS: lockout/recovery, company access, invoice and receipt policy values, normal PDF download/retry |

The limiter suite uses the actual restricted application login and production
identity functions. It exercises failure counts 1–5, normalized email keys,
active-block stability, expired lockouts/windows, clearing and concurrent inserts.
Only unique synthetic limiter rows are created and cleaned up.

The PDF database suite uses a restricted login and a read-only transaction over
the synthetic issued invoice. Real bigint metadata and local bytes pass through
the application service. A retry returns the same PDF ID and identical bytes.
Missing capability, foreign company, anonymous and nonmember requests are denied.
The suite accepts `AMS_TEST_USER_EMAIL`, `AMS_TEST_ORGANIZATION_ID` and
`AMS_TEST_INVOICE_ID`; select an isolated database and an existing synthetic
posted invoice with registered local PDF bytes before running it.

Exact database test commands in this PowerShell session:

```powershell
$env:AMS_DATABASE_TESTS='isolated'
npm run test:database:login-limiter
$env:AMS_TEST_USER_EMAIL='e2e-20261020-1550@example.invalid'
$env:AMS_TEST_ORGANIZATION_ID='71333926-a767-46d7-8710-40bb119842d5'
$env:AMS_TEST_INVOICE_ID='19c9f03f-d259-4b4d-bc62-254ee346ca2f'
npm run test:database:invoice-pdf
```

Read-only ledger observation after the migration: exactly two posted sources,
two journals/four lines, debit = credit = BDT 16,000.00; bank BDT 6,000.00,
receivable BDT 4,000.00, revenue BDT 10,000.00; one allocation of BDT 6,000.00.
This administrative observation proves the fixture remained unchanged, not RLS
or general accounting concurrency correctness.

## Browser evidence and limits

Edge submissions produced counters **1, 2, 3, 4, 5**. The fifth failure set the
block, and a subsequent correct password still returned the generic denied
message without incrementing/extending it. For the recovery check, only this
synthetic account's window/block timestamps were aged using the restricted
login; this was an artificial expiry, not a 15-minute wall-clock wait. A normal
correct-password sign-in then reached Your companies and cleared the limiter row.

Both invoice and receipt review panels display policy version **1**, required
approvals **1**, and list progress **1 / 1**. Existing posted approvals remain
non-actionable; their decisions were not changed or used as independent human
review. The synthetic sole-owner policies are test fixtures only.

The actual invoice link downloaded
`invoice-db08b32b-b0cf-4982-9d1f-b2061eb635af.pdf` into Edge's Downloads folder.
A second normal link click emitted a browser download event and left the invoice
page open. Both files are 15,402 bytes with SHA-256
`7f88170c52fa0b2aded9b0a600d1d1c20340aace9739538109269d33f219ac07`, matching immutable
metadata. `pdfinfo` confirmed a single A4 PDF 1.3 page; Poppler rendering showed
the issued invoice number, Bangla/English customer details and BDT 10,000.00 total
without clipping. `pypdf` confirmed the English number/customer/total but emitted
a font CMap extraction warning; complete Unicode text extraction/accessibility
is not certified by this download repair.

Raw command logs, auth-state observations, DOM captures, downloaded PDF, rendered
page and screenshots are retained locally under
`output/playwright/2026-10-20-fixes-e2e/`.

Reviewable evidence: [limiter database results](evidence/login-approval-pdf-2026-10-20/login-limiter.log),
[PDF database results](evidence/login-approval-pdf-2026-10-20/invoice-pdf.log),
[browser counter observations](evidence/login-approval-pdf-2026-10-20/browser-auth-state.jsonl),
[invoice review DOM](evidence/login-approval-pdf-2026-10-20/approval-invoice.txt),
[receipt review DOM](evidence/login-approval-pdf-2026-10-20/approval-receipt.txt),
[Edge-downloaded PDF](evidence/login-approval-pdf-2026-10-20/issued-invoice.pdf),
[successful login screenshot](evidence/login-approval-pdf-2026-10-20/login-recovered.jpg).
The [complete application test log](evidence/login-approval-pdf-2026-10-20/application-tests.log)
and [optimized build log](evidence/login-approval-pdf-2026-10-20/build.log) are also retained.
The company-selection screenshot succeeded. Approval-page screenshot capture
timed out (including a 20-second CDP capture), so its evidence is the actual
rendered DOM captured from Edge; no visual-regression pass is claimed.

This repair does not certify all 52 business/20 security cases, full RLS coverage,
provider delivery, recovery/restore, performance targets, independent accountant
review or production readiness. No visual baseline or complete accessibility
audit was run. The earlier dependency audit (7 high, 2 moderate findings) and
signup error-state field retention are separate unresolved findings.
