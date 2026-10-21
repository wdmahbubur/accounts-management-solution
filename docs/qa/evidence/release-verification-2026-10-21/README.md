# Release verification receipts

Base: PR #185, `759b298590366ca3c24e3325a166a25477875d15`. Target: isolated PostgreSQL 18, restricted runtime/worker logins and private `ams-recovery-drill` object bucket. Private configuration, credentials, downloaded engine binaries/signatures and object byte backups are excluded from Git.

Implementation: `2c84057484008669bd7dc7468baa54c9eec80509`. Checks below ran against its application/SQL/test contents. This evidence follow-up only records the SHA and trims terminal trailing whitespace in three static/build receipts; no outcomes are changed.

- [Cash-flow database tests](cash-flow-finalization-accepted.log): 4 passed, no skips.
- [Real ClamAV worker tests](scanner-real.log): 5 passed, no skips, engine 1.5.4/database 28160.
- [Private CSV/PDF/XLSX integration](exports-readable-pdf-accepted.log): 6 passed, no skips.
- [Real password-authenticated HTTP](http-report-flows-accepted.log): 7 passed, no skips.
- [Restricted golden-book readback](golden-browser-database.log): all six source journals balance and reports agree.
- [PDF geometry](pdf-layout.json) and [final pagination check](pdf-pagination-accepted.json): exact original profit, no technical field names, five numbered stress pages, no out-of-bounds characters. [Rendered real private report](readable-report.png).
- [Golden dashboard](golden-dashboard.png): earned revenue 10,000, expenses/profit 5,000 each, Cash 0, Bank 102,000 and total assets 106,000 for January 2025.
- [Finalized cash-flow view](cash-flow-finalized.txt) and [actual Edge JSON download](finalized-cash-flow-download.json): selected finalization `59fae944-cbc2-4d31-88cd-3df97925076b`, operating 2,000, financing 100,000, closing 102,000 and zero difference.
- [Golden balance sheet](golden-balance-sheet.txt): assets 106,000 equal liabilities 1,000 + capital 100,000 + untransferred earnings 5,000.
- [Golden regression](golden-journal-register-accepted.log): 10 passed after migrations 0118-0119, including the six-source register and allocation/unapply counterparts. [Migration 0118](migration-0118.log), [migration 0119](migration-0119.log): canonical receipt/checksum verification complete, 118 files through 0119.
- [Edge PDF export job](golden-export-jobs.txt), [worker receipt](browser-export-worker.log), [download inspection](golden-pdf-inspection.json) and [render](golden-pdf.png): BDT 5,000 profit and every summary/account value match the displayed golden report, one numbered page, no clipping.
- [All-source journals](golden-journals.txt), [bank GL](golden-general-ledger.txt), [cashbook](golden-cashbook.txt), [trial balance](golden-trial-balance.txt), [AR](golden-receivables.txt), [AP](golden-payables.txt), [customer statement](golden-customer-statement.txt), [supplier statement](golden-supplier-statement.txt) and [P&L](golden-profit-loss.txt).
- [Empty beta company](company-switch-beta.txt), [history guard](company-switch-history.txt) and [old dashboard URL guard](company-switch-old-dashboard.txt): explicit company-context separation in the user's Edge browser.
- [Lint](lint-release.log), [TypeScript](typecheck-verified.log), [341 application tests](unit-release.log) and [optimized build](build-release.log) passed. Production-mode browser startup remains outside this evidence.

Browser company: `ff2673c0-021f-43fe-b84a-96028da68ad0` (Golden alpha); empty comparison company: `897a7b45-9867-4c58-a508-4cc505afb7ed` (Golden beta). Actor identifiers and example.invalid addresses are synthetic. Login credentials and session cookies are not evidence artifacts. Capital was prepared as a draft through the existing test helper, then previewed/submitted/posted in Edge. The other five sources were entered, saved, previewed, submitted and posted through the actual Edge forms; this is not a claim that fixture provisioning was a user onboarding flow.

The report describes limitations and superseded exploratory failures. These receipts do not authorize production deployment or establish professional accounting review, worldwide legal compliance or a performance guarantee.
