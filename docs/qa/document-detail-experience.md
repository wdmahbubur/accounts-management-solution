# Financial document detail repair

## Scope and source contract

This slice supports [US-030 / issue 50](https://github.com/wdmahbubur/accounts-management-solution/issues/50), UI-14 and T-49: issued customer, item and tax evidence stays unchanged after directory edits. It also restores saved cash movement, transfer and journal details on the generic source page. It does not change accounting or posting commands.

The detail page now separates its heading/state/amount, issued party, dates and terms, item lines, cash movement, settlement and accounting sections. Delivery, approval, correction and activity history use native expandable sections. Reversal controls and technical identifiers are secondary disclosures. Approved unnumbered sources retain their actual state and source name. Permitted header actions follow the existing command capabilities; readers do not load write-only draft options.

Customer details are formatted only from `party_snapshot` through the shared contact formatter. No live customer lookup replaces issued data. Item and cost-center snapshots still come from the existing authorized snapshot read. Quantities and unit rates preserve up to six decimal places; financial amounts and journal totals use exact strings and integer arithmetic.

## Read-model change

`0090_readable_financial_document_details.sql` replaces only `read_financial_document`:

- Preserve source visibility, saved amounts, version, digest, snapshot content and row order.
- Add labels only for tenant-qualified references on the requested source. No bank account numbers, unrelated balances or broad directory lists are returned.
- Include all posted journal lines, descriptions, cost centers, cash-flow classes and open-item reference/due-date metadata for `ledger.read` callers.
- Return `posted_journal: null` without `ledger.read`. The previous SQL returned this payload to all source readers even though the UI hid it.
- Keep inactive historical account labels readable. Journal party labels use the immutable source snapshot when the line references the source party.

## Verification and integration

Completed in the isolated detail worktree:

```bash
node --conditions=react-server --test tests/application/document-detail.test.ts
node --check tests/database/document-detail-read.mjs
```

All **7 focused application tests passed**. They cover approved headings, immutable party formatting, exact decimal display and complete journal totals, action permissions, authorized navigation and preservation of enriched evidence through the existing service.

The committed database script requires an explicitly selected isolated database through migration 0090, `TEST_DATABASE_URL` for unique fixture setup, and `TEST_DATABASE_RUNTIME_URL` for the actual restricted `ams_app_login`. It uses native Node WebSocket and 30-second connection timeouts. It verifies direct RPC results in read-only transactions, full invoice/manual/transfer evidence, source-only versus ledger access, contact edits and account archival, cross-company denial and unchanged financial effects. Existing fixture organizations are preserved; new committed synthetic posting evidence is retained.

For a local environment containing the standard isolated owner/runtime variables:

```bash
node --input-type=module <<'VERIFY_DETAIL'
import './scripts/load-local-env.mjs';
process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
process.env.TEST_DATABASE_RUNTIME_URL = process.env.DATABASE_RUNTIME_URL;
await import('./tests/database/document-detail-read.mjs');
VERIFY_DETAIL
```

Integration verification on 2026-10-09 (Asia/Dhaka):

- The shared contact formatter and compatible draft/reversal changes are integrated.
- `npm run check` passed: lint, typecheck, **221 application tests** (zero failures/skips), and the Next.js build.
- The ordinary migration runner upgraded the existing isolated database from **88 to 89 files**. Hash comparisons of every row in 12 financial tables for the existing browser-test company were unchanged.
- All **six real-role database verification groups passed**, using `ams_app_login` without superuser or RLS-bypass privileges. The test exercises saved/approved/posted synthetic sources, exact complete reads, source-versus-ledger permissions, inactive account labels, immutable issued content and cross-company denials.
- The archival fixture advances the account's row version; the existing version guard stays enforced.

Deployment and browser acceptance, including the tested viewports and external-provider coverage, are recorded separately in the pull request and batch release evidence. New synthetic test organizations are retained, including evidence from a fixture run stopped by the account-version guard.

Remaining scope limits: supplier payment details show their saved allocation plan without inventing a current supplier settlement balance; existing specialized lifecycle APIs are retained. This repair does not claim every document type's lifecycle or delivery workflow is complete.
