# Supplier payment choices and settlement reads

## Contract and implementation

This bounded repair supports US-035 / issue 58, FR-10, UI-21/UI-22 and the existing allocation contract. Migration `0092_supplier_payment_read_models.sql` adds two read-only public RPCs; it does not replace saving, approval, posting, allocation, reversal or money arithmetic.

`read_supplier_payment_allocation_options` requires `purchases.write`, `documents.read` and `dues.read`, an active same-company supplier, and the current active/postable AP control mapping. It returns posted, unreversed, same-supplier bill credit items that are effective on the selected date. Draft, void, future and reversed sources are excluded. The API preserves exact amount strings and fails closed on malformed, duplicate, cross-company, cross-party or oversized results.

`residualAmount` is the balance on the selected accounting date. `availableAmount` is the minimum capacity across that date and every later allocation/unapply boundary. A future unapply does not allow an earlier payment to exceed the intervening capacity. Saved drafts do not reserve capacity; the existing posting/allocation locks remain authoritative. More than 1,000 eligible options produces an explicit error rather than silently truncating the list; pagination is outside this slice.

`read_supplier_document_lifecycle` requires `purchases.read` and visibility of the requested source. It reports company-local today, current residual, settlement state and dated allocation/correction history for bills and supplier payments. Future history remains visible with its effective dates while current totals exclude future effects. Counter-document identity and corrections are independently permission-scoped. A future reversal is not reported as already effective. Reversal auto-allocation may contribute to `applied_amount`; consumers must not label that value as payments to bills when the source is reversed.

The existing submit rule from migration 0025 is unchanged: a supplier payment needs at least one bill allocation before approval. A completely unallocated payment can be saved and the existing cash planner can preview it, but it cannot be submitted. Excess money on a payment with a valid allocation remains a supplier trade debit. This repair does not reinterpret that debit as an expense, deposit or automatic application. The UI must state the allocation requirement before submission.

## Local verification

The implementation passed these focused checks:

```bash
node --conditions=react-server --test tests/application/supplier-payments.test.ts
npm run typecheck
```

All **nine application tests passed**, with no failures or skips. They cover exact date/capacity parsing, tenant and party scope, malformed/duplicate/oversized results, service permissions, lifecycle history and permission-scoped errors. Changed-file ESLint and `git diff --check` also passed. The database verifier passed `node --check` and scoped ESLint.

Root applied migration 0092 through the ordinary migration runner to the explicitly isolated synthetic database, advancing its migration count from 90 to 91. The installed file SHA-256 is `254613eae4de022e4a0b74f9dc390574cef321c1d75422fd2d52c43e033a4ea7`. No historical migration was modified and no checksum override was used.

## Real-database verification

Run only against a deliberately selected isolated database through migration 0092:

```bash
AMS_DATABASE_TESTS=isolated node tests/database/supplier-payment-workflow.mjs
```

The script loads the existing local environment without printing it. Prefer `TEST_DATABASE_URL` and `TEST_DATABASE_RUNTIME_URL`; supported fallbacks are `MIGRATION_DATABASE_URL` / `DATABASE_URL` and `DATABASE_RUNTIME_URL`. Owner and runtime must identify the same database, and the runtime login must be the actual `ams_app_login`. Connection and statement timeouts are 30 seconds; lock timeout is 15 seconds. Each run creates unique synthetic organizations and preserves existing fixture companies. It does not reset the database or call external providers.

On 2026-10-09, all **seven grouped checks passed**:

1. Verify the actual runtime login has no superuser, RLS-bypass or role-creation privilege. Create and zero-activate a new company through runtime commands. Privileged identity/profile/role/contact/bank fixture seeding is explicitly separate.
2. Read exact supplier references and capacity in `READ ONLY` transactions. Deny insufficient capabilities, customer-only contacts, foreign parties and foreign companies. Allow saving an unallocated draft without `dues.read`, while rejecting an allocated draft without that capability.
3. Preview and post a `900.00` payment, allocating `600.00` and `200.00` to two bills and retaining `100.00` as unused supplier trade debit. The journal contains exactly AP debit `900.00` and bank credit `900.00`, with no second expense. Replaying the same posting key returns the same receipt without new effects.
4. Reject a wrong-supplier target atomically. Editing an approved `20.00` allocated payment to `21.00` returns it to draft, advances its version and rejects the old posting version.
5. A future `800.00` allocation against a `1000.00` bill leaves today's residual `1000.00` but capacity `200.00`. A later unapply restores capacity only at the correct boundary. A backdated `201.00` preview fails without writes. Current lifecycle totals and future history stay distinct.
6. Exclude draft, void, future and reversed sources. Report effective reversal state correctly, retain the original journal, mask generic reversal identity from a purchases-only reader and expose it to the permitted owner. Keep a future reversal from changing today's unpaid status. The void source alone uses an explicit privileged state fixture, with no financial postings.
7. Race two independent restricted connections, each posting `6.00` against one `10.00` bill. Exactly one commits and creates a journal; the other receives conflict `23P01`, leaving `4.00` outstanding.

Read/preview assertions compare source states/versions/digests/numbers, sequence values, and counts of journals, lines, open items, allocations, unapplies, audit, outbox and idempotency records before and after. These checks supplement the read-only transaction boundary; they are not a byte-for-byte snapshot of every database table.

Final retained fixture: company `88df2177-6653-4947-9a83-0df882138afe`, first bill `8f46028e-ce93-42e5-ac8a-45e54dc11a13`, payment `e7b5d04f-df18-46a5-8c1c-ab9e13cb70a5`. A prior run stopped at an incorrectly unallocated approval fixture, demonstrating the existing nonempty-plan rule; that fixture was corrected to a valid `20.00` allocation without changing database policy. Its unique company `9e01c0d8-1541-4dd3-ac68-876f81828b09` is retained separately.

The execution log is retained in batch evidence as `accounts-batch3/validation/supplier-payment-database.log`. Browser acceptance, deployment identity, existing-company forward-upgrade hashes and provider verification are owned by the integrated release checks. This isolated verifier does not establish those results or complete all canonical story acceptance criteria.
