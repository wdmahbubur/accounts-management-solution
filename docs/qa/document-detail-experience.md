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
- Synthetic users, roles, contacts, accounts and company activation in that runner use privileged fixture setup. The document commands and permission-sensitive reads use the restricted runtime connection; these groups are separate from ordinary browser setup evidence.
- The archival fixture advances the account's row version; the existing version guard stays enforced.

Browser acceptance on the branch preview confirmed customer create/reload, a two-tab stale update with retained input and explicit latest-version recovery, and preservation of unknown legacy contact metadata. Updating the live customer's name, address, postal code and TIN did not change the existing invoice's issued snapshot, version, digest or posted journal identity.

A new invoice exercised quantity `2.5`, unit price `123.456789` and discount `8.64` (line total `300.00`), plus a `0.005000` unit-price line (rounded to `0.01`). Live calculation, save, reload, version-2 preview, approval and posting all agreed on `300.01`. Unsaved edits disabled preview/approval; approved unnumbered sources displayed their actual state. The posted invoice showed all three balanced journal lines. The earlier `1250.37` receipt and paid invoice remained correctly linked and readable.

## Reversal completion follow-up

The browser exposed an existing backend failure after valid reversal preparation: `reverse_posted_document` emitted `document.reversed`, but the private enqueue allowlist in migration 0018 omitted that event type. The final enqueue failed and rolled back the command. This was unrelated to UTC or the chosen company date.

`0091_source_reversal_outbox_event.sql` adds only this existing financial event to the private allowlist. Payload type/size checks, recursive sensitive-key rejection, tenant-qualified references, deduplication identity and private execution privileges are unchanged. Financial events are not added to the email worker's delivery types.

The ordinary runner applied 0091 to the isolated database (**89 to 90 files**). A new before/after comparison found all rows in the same twelve financial tables unchanged. The original 0090 upgrade was separately verified from 88 to 89 files.

`tests/database/source-reversal-outbox.mjs` passed **seven real-database groups**. Actual `ams_app_login` performed the authorized reversal, exact inverse-journal check, deferred-constraint check, permission denials and idempotent replay. A separate privileged transaction inspected the private event/audit/receipt and exercised unsafe-payload and dedupe rejections. Both successful test reversals and all probes were fully rolled back; no grants or role changes were made.

Run it only against an explicitly selected eligible synthetic invoice:

```bash
AMS_DATABASE_TESTS=isolated \
TEST_REVERSAL_ORGANIZATION_ID=<synthetic-company-uuid> \
TEST_REVERSAL_DOCUMENT_ID=<eligible-synthetic-invoice-uuid> \
node tests/database/source-reversal-outbox.mjs
```

A separate `9.99` invoice was created, approved and posted through the browser, then successfully reversed through the form as `REV-FY 2026-000001`. Its linked original is `INV-FY 2026-000004`. Earlier dates were blocked by native validation; the valid company date completed successfully. Reload preserved the reversal and both exact opposite journal lines. The customer's receivable returned from `310.00` to `300.01`. These committed synthetic records are retained as browser evidence.

Deployment identities, screenshots and external-provider coverage are recorded separately in the pull request and batch release evidence. New synthetic test organizations are retained, including evidence from a fixture run stopped by the account-version guard.

Remaining scope limits: supplier payment details show their saved allocation plan without inventing a current supplier settlement balance; existing specialized lifecycle APIs are retained. This repair does not claim every document type's lifecycle or delivery workflow is complete.
