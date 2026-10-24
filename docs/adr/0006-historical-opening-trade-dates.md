# ADR 0006 — Historical due dates in opening trade balances

Date: 24 October 2026. Scope: #174 / #78 / #82. Status: implemented candidate; labelled AI accounting/code review for the internal gate under #115. Independent accountant/release review is not represented by this record.

The limitation documented in ADR 0003 prevents an existing company importing its original overdue receivables/payables faithfully. The user authorized fixing the remaining launch blockers. Retain the source's original due date and reference on each opening AR/AP detail. The amount is the remaining unpaid balance at cutover, not a reconstruction of the original invoice amount or prior transactions.

`open_items.issue_date` continues to mean ledger/subledger availability and remains equal to the journal accounting date. The opening journal remains on `books_start_date - 1` under the existing approved setup contract. Historical due dates therefore affect aging at/after cutover but cannot create pre-cutover allocation capacity or ledger balances. No historical invoices, revenue, expenses or prior allocations are fabricated. An original invoice issue date is not inferred or newly represented.

Migration 0128 replaces the universal due-date ordering check with a finite-date constraint plus source-aware validation at construction, insert and deferred control-line agreement. A pre-availability due date is allowed only for AR/AP on the real opening journal and opening-balance document at that company's exact cutover. Ordinary documents, manual journals, advances and other control kinds retain their existing ordering rule. The shared private predicate is not executable by runtime/worker roles.

Approval material, row version, exact prior trial balance/control detail, zero suspense, setup atomicity, idempotency and period/year locking use the existing services and remain required. Existing posted facts are not changed. Aging and report/export snapshots preserve original reference/due date evidence; issued source documents remain immutable. Forward migration is required; rolling application code back must not restore old financial data or reapply the old constraint over valid new opening evidence.

This decision adds due-date fidelity to the bounded opening-balance import. It does not add a full historical transaction import, foreign exchange or worldwide tax/compliance acceptance. Verification and remaining limitations are recorded separately in QA evidence.

The Edge evidence-download check exposed a second omission: the original export contained aggregate trial balance rows only. Migration 0129 extends that same permission-checked read with source identity/version/state/currency and individual control detail, including original reference/due date and cutover availability. The source must be readable under the caller's live document permissions. Posted source rows remain authoritative; no duplicated ledger or export evidence table is introduced.
