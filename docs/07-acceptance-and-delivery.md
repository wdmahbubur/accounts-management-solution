# Acceptance Tests, Delivery Order and Release Checklist
## AMS V1.0 · 29 September 2026

## 1. Verification boundary

The package includes a dependency-free Python reference calculation/ledger test model and static specification checks. These verify selected illustrative arithmetic and internal artifact consistency only. They do **not** execute PostgreSQL, Supabase RLS, browser flows, production migrations or the future application. Actual database/security/concurrency/integration tests below are mandatory implementation work.

## 2. Golden business scenario

Use a clean test company, BDT, no tax, one bank account, one AR and one AP control. All dates are illustrative test dates, not real company records.

| Sequence | Event | Expected impact |
|---|---|---|
| 1 | Owner contributes 100,000 into bank | Bank 100,000; capital 100,000; revenue 0 |
| 2 | Earned invoice to customer A, 10,000 | AR 10,000; revenue 10,000 |
| 3 | Receive 6,000 and allocate to that invoice | Bank 106,000; AR 4,000; revenue still 10,000 |
| 4 | Record expense bill from vendor A, 4,000 | Expense 4,000; AP 4,000 |
| 5 | Pay vendor A, 3,000 and allocate | Bank 103,000; AP 1,000; expense still 4,000 |
| 6 | Record paid rent, 1,000 | Bank 102,000; total expense 5,000 |
| Result | Financial statements | Revenue 10,000; expense 5,000; profit 5,000; bank 102,000; AR 4,000; AP 1,000 |
| Check | Balance sheet | Assets 106,000 = liabilities 1,000 + capital 100,000 + untransferred profit 5,000 |
| Check | Cash flows | Financing +100,000; operating +2,000; net cash +102,000 |

Every source must have exactly one balanced journal. Receipt/payment allocations explain outstanding balances without an extra income/expense journal. The same scenario must pass service, database and browser end-to-end suites before launch.

## 3. Functional and accounting acceptance matrix

| ID | Test | Expected result |
|---|---|---|
| T-01 | Draft invoice created/edited | No GL/revenue impact |
| T-02 | Post 10,000 earned invoice | Dr AR 10,000, Cr income 10,000, one control item |
| T-03 | Repeat post with same idempotency key | Same source/journal IDs, no duplicate |
| T-04 | Repeat same key with changed amount | Conflict, no new effect |
| T-05 | Repeat post with different key | Existing posted result or controlled conflict; never second journal |
| T-06 | Receive 6,000 against 10,000 invoice | Residual 4,000; revenue unchanged |
| T-07 | One receipt across three invoices | Sum applied ≤ receipt; each residual correct |
| T-08 | Receipt exceeds invoice total | Available trade credit visible; no extra revenue |
| T-09 | True customer advance | Bank debit/liability credit; revenue zero |
| T-10 | Apply customer advance | Reclassification plus two allocations; no second bank movement |
| T-11 | Supplier advance/application/refund | Correct asset, AP, bank and residual behavior |
| T-12 | Partial customer credit | Reverse approved revenue/deferred and tax components, not full invoice |
| T-13 | Refund greater than eligible credit | Reject |
| T-14 | Vendor bill then payment | Expense recognized once; payment reduces AP |
| T-15 | Paid equipment purchase | Asset increase, not forced expense |
| T-16 | Recoverable versus nonrecoverable input tax | Correct input-asset versus expense/asset-inclusive treatment |
| T-17 | Inclusive versus exclusive illustrative 10% | 11,000 inclusive = 10,000 net + 1,000 tax; correct line sums |
| T-18 | Fractional quantities and half-up rounding | Deterministic 2-decimal totals, no floating drift |
| T-19 | Zero, negative, NaN, infinity, excess-scale amounts | Rejected according to documented input rules |
| T-20 | Unbalanced/one-line/manual double-sided journal | Database rejects commit |
| T-21 | Manual direct AR/AP without party/item | Reject |
| T-22 | Posted source or GL line edit/delete | Reject even through alternate application path |
| T-23 | Reverse posted source | New exact opposite entry; original remains; dates respected |
| T-24 | Reverse same source twice | Reject second reversal |
| T-25 | Reverse reconciled payment | Block until authorized reconciliation reopen |
| T-26 | As-of aging before/after receipt and unapply dates | Correct historic residual, not today's residual |
| T-27 | Dual customer/vendor contact | AR and AP remain separate; no unauthorized netting |
| T-28 | Bank transfer with fee | Both bank legs atomic; fee explicit; internal principal not revenue |
| T-29 | Bank statement import only | No GL movement |
| T-30 | Exact file/provider transaction reimport | No duplicate observations |
| T-31 | Two legitimate equal-value bank rows | Warn/review fingerprint, do not silently delete real transaction |
| T-32 | Partial/many-to-one reconciliation | Capacity/direction/account checks; no duplicate journal |
| T-33 | Finalize nonzero unexplained bank difference | Reject |
| T-34 | Lock period then backdated posting/allocation/unapply | Reject all paths |
| T-35 | Reopen period | Reason, recent auth, privileged capability, audit; snapshots retained |
| T-36 | Change amount/date/bank/allocation after approval | Increment version; invalidate decision; new review required |
| T-37 | Maker attempts self approval | Reject unless explicitly enabled/logged sole-operator policy |
| T-38 | Opening balances with AR/AP details | Control tie-outs, no new historic revenue, zero suspense |
| T-39 | Mid-year cutover YTD summary | Included once in annual P&L, labeled summary detail |
| T-40 | Year close and report rerun | Profit transferred once; historic P&L not zeroed by close mechanics |
| T-41 | Year reopen/reclose | Preserve old run, one active close, no double retained earnings |
| T-42 | Unclassified cash-flow entry | Provisional report; finalization blocked |
| T-43 | Outbox email renderer failure | Posted journal unchanged; safe retry delivery only |
| T-44 | Export filters/cutoff | File totals match requested screen/report snapshot |
| T-45 | Duplicate billing webhook | One entitlement outcome; no tenant GL changes |
| T-46 | Subscription expires/downgrade | Policy-based read-only state; no data deletion or partial posting |
| T-47 | Journal/AR/AP/cashbook/P&L/BS golden scenario | All totals above agree |
| T-48 | Account archived or classification changed after use | Posting blocked to inactive/group account; historical classification protected |
| T-49 | Issued invoice after contact/tax configuration edit | Original snapshot/PDF preserved |
| T-50 | Foreign currency supplied | V1 validation rejects, rather than silently treats as BDT |
| T-51 | Reuse credit backdated before its earlier allocation reversal | Reject if any historic date would be over-allocated, even when today's residual is sufficient |
| T-52 | Credit-note line targets a line on a different original invoice | Reject original-parent mismatch; cumulative eligible quantity/basis enforced |

## 4. Security and concurrency matrix

| ID | Attack/race | Required result |
|---|---|---|
| S-01 | User from company A guesses company B source/account/file UUID | No data leak or write; permission-safe 404/denial |
| S-02 | Same user belongs to both companies; inject B account into A journal | Composite FK/command checks reject |
| S-03 | Billing role requests P&L, AP, private bank balance or vendor evidence | Denied, even though tenant membership is valid |
| S-04 | Change user-editable metadata to Owner | No authority change |
| S-05 | Invoke API/Server Action directly without visible button | Same permission enforcement |
| S-06 | Invoke private function anonymously or with forged actor/org | Denied |
| S-07 | Removed member uses still-unexpired access token | Next sensitive command denied by live membership check |
| S-08 | Two concurrent 6,000 allocations against 10,000 residual | At most one full 6,000 succeeds unless explicit smaller retry; residual never negative |
| S-09 | Concurrent posts to same document under different keys | Exactly one journal |
| S-10 | Posting races with period lock | Commit before lock or fail after it; no bypass |
| S-11 | Two cash spends exceed allowed physical cash | Balance rule holds under concurrency |
| S-12 | Two bank matches consume same remaining row capacity | No over-match |
| S-13 | Role escalation/last-owner removal race | No unauthorized grant; at least one active owner remains |
| S-14 | Guess export job or use link after membership revocation | New download request denied; bound lifetime of previously issued links documented |
| S-15 | Reuse previous company's cached dashboard on switch | No cross-tenant response/cache leak |
| S-16 | Malicious filename/path, content-type spoof or spreadsheet formula | Upload validation/scan and safe export escaping; no path traversal/formula execution |
| S-17 | Deadlock/serialization failure | Bounded whole-transaction retry, no partial financial writes |
| S-18 | Kill process after DB commit before response | Replay returns existing source/journal; outbox still deliverable |
| S-19 | Crash worker mid-delivery | Lease expiry/idempotent retry, no reposting |
| S-20 | Unapproved support operator requests tenant ledger | Denied; approved exceptional access time-bounded and audited |

Database tests run as anon, ordinary authenticated users, each role template and the worker role—not only as postgres/service_role. Include direct routine calls, alternate API paths and bulk imports. Run isolated multi-connection tests for races; a sequential unit test is not a concurrency test.

## 5. Delivery milestones (dependency-based, not time promises)

| Milestone | Deliverables | Exit gate |
|---|---|---|
| M0 Product/accounting agreement | V1 scope, tax assumptions, COA/report mappings, pilot data policy, acceptance fixture | Product owner + accounting reviewer approve assumptions |
| M1 Secure foundation | Repo/package boundaries; auth; tenant onboarding; roles; schema migrations; storage policy; CI | Cross-tenant and role-access tests pass; restore empty seeded environment |
| M2 Accounting engine | Decimal rules; period lock; posting/reversal; open items; allocation; idempotency; audit/outbox | Golden ledger and all critical cross-row guards pass in PostgreSQL, including races |
| M3 Daily finance flows | Customer/vendor/item UI; invoices; bills; expenses; receipts/payments; credits/refunds/advances; approvals | Representative end-to-end paths produce correct statements |
| M4 Reports and close | GL/TB/P&L/BS/aging/statements/cash flow; opening imports; bank reconciliation; period/year close | Accountant reconciles an entire pilot period and reopens/recloses safely |
| M5 SaaS operations | Plan entitlements; billing events; document/email/export workers; support console; backup/incident runbooks | Provider sandbox tests, export/restore drill, operational alerts verified |
| M6 Pilot release | Real restricted pilot use, usability fixes, accountant review, security review, launch documentation | Critical defects resolved; three pilot organizations complete a reconciled period |

Roles required: product owner; accounting/domain reviewer; full-stack/database engineering; QA/security review; operational owner. One person may cover several roles, but an implementer should not be the only reviewer of ledger correctness and tenant security.

## 6. Prioritized implementation backlog

| Epic | Priority | Representative stories | Dependencies |
|---|---|---|---|
| E01 Tenant/security | P0 | Onboard company; secure switch; role matrix; private objects | M0 |
| E02 Ledger core | P0 | Post source atomically; validate balance; block direct edits | E01 |
| E03 Control subledgers | P0 | Open-item creation; partial allocation; historical unapply | E02 |
| E04 Sales and purchases | P0 | Draft/review/post invoices and bills; receipts/payments | E02/E03 |
| E05 Corrections/advances | P0 | Credit, refund, reversal, advance reclassification | E03/E04 |
| E06 Period/report foundation | P0 | GL/TB, dates, locks, source drilldown | E02 |
| E07 Migration/reconciliation | P0 | Opening import, statement mapping, matching/finalization | E03/E06 |
| E08 Statements/year close | P0 | P&L, BS, aging, cash flow, closing earnings | E05/E06/E07 |
| E09 Evidence/approval | P0 | Versioned maker-checker, immutable evidence, audit | E01/E04 |
| E10 Jobs and delivery | P0 | Outbox, PDF/email/export/import worker retries | E02/E09 |
| E11 SaaS billing/operations | P0 before paid launch | Entitlements, webhook verification, restore and support controls | E01/E10 |
| E12 Product polish | P1 | Saved filters, search shortcuts, localized templates | Core flows proven |
| E13 Growth modules | P2 | Recurrence, budgets/projects, receipt AI drafts | Post-pilot separate PRD |

P0 does not imply simultaneous development. Build the ledger vertical slice before broad screens: company → account → earned invoice → collection → TB/BS/P&L → reversal. Then expand the same tested command contracts.

## 7. Definition of done per story

A story is done only when authorization, validation, error/empty/loading states, audit evidence, tests and documentation are included; monetary behavior has golden expectations; no browser-only safeguard is the sole control; migrations install on clean DB and upgrade the current version; UI is keyboard usable; logs avoid sensitive payloads; and relevant recovery/export paths are understood.

Do not mark “Bank reconciliation complete” merely because a page imports CSV, or “Accounting complete” merely because a dashboard adds income and subtracts expense.

## 8. Production checklist

Confirm selected provider/database versions; rerun schema/security advisors; verify least-privilege grants and public schemas; confirm secret-key hygiene; run all P0 test matrices; validate rate limits; configure private buckets/scanning; deploy queue consumers and failure alerts; verify payment signatures and duplicate handling; enable and test backups/object restoration; approve retention/data-residency terms; freeze default account/report/tax policies; record accountant sign-off and launch scope; create operational escalation and rollback plans.

Deployment rollback must account for database compatibility and queued events, not only a web-app version. Never undo committed customer books by rolling back to an old database backup as a routine application deployment rollback.
