# Explicit application of a posted trade credit

## Bounded contract

The new detail action applies a posted customer credit to its named original invoice, or a posted supplier credit to its named original bill. It uses the existing `allocate_open_items` money-event command. Posting a credit and applying it are separate, explicit actions. Application does not issue a new journal or cash movement and does not rewrite the original trade document.

Migration `0094_credit_application_read_options.sql` is read-only. It requires `dues.read` and existing source-read authorization for both the credit and original. All open-item and history joins are company-qualified. Counter-document identity is independently permission-scoped. The mutation continues to require `dues.allocate`; this UI does not broaden that permission or replace generic allocation compatibility checks.

The selected effective date must reach both items' availability dates. Available capacity is the smaller residual across both items at the selected date and every later allocation/unapply boundary. The amount remains an exact string; the form preserves the exact submitted body and idempotency key until an uncertain result is confirmed. A confirmed application can be followed by a fresh balance read. The options response does not reserve money or promise that a fiscal period remains open until submission.

Known linked reversals conservatively disable a new application. A credit whose original is already settled stays available separately; the page must not imply that this credit has reduced the original below zero. A future source is explicitly not yet effective. The existing generic allocation command remains capable of other compatible settlements; the named-original scope belongs to this deliberate read/action path.

## Independent source review

The supplier-workflow reviewer independently read migration 0094, the pure options/receipt parser, server service, route and client action. No blocking authorization, cross-company, historical-capacity or replay issue was found. Review checked both-source visibility, masked counter-document references, future allocation/unapply boundaries, exact-money comparisons, confirmed receipt amount/date and retained request identity after uncertain transport responses. This source review is separate from database and browser evidence.

## Isolated database verifier

The runnable verifier is `tests/database/credit-application-workflow.mjs`:

```bash
AMS_DATABASE_TESTS=isolated node tests/database/credit-application-workflow.mjs
```

It must run only after reviewed migrations 0093 and 0094 are installed in an explicitly selected isolated database. It loads the existing local environment without printing it. Prefer `TEST_DATABASE_URL` and `TEST_DATABASE_RUNTIME_URL`; supported fallbacks are `MIGRATION_DATABASE_URL` / `DATABASE_URL` and `DATABASE_RUNTIME_URL`. Owner and runtime must identify the same database and the latter must be the actual `ams_app_login`. Connection/statement timeouts are 30 seconds and lock timeout is 15 seconds.

Every run creates unique synthetic companies and retains its evidence. Privileged SQL seeds identities, profiles, custom roles, contacts and a cash account only. Company creation/zero activation, review policies, trade/cash saving, submission, posting, credit application, unapply and reversal use the restricted login. New companies keep browser acceptance fixtures separate. No reset, external provider operation, role grant or historical migration override is performed.

The six grouped scenarios cover:

1. Actual runtime role properties and explicit fixture setup.
2. Customer credit application, two simultaneous identical-key requests, subsequent replay, altered-payload conflict and exact remaining balances. Full journal/line facts, issued source evidence, sequences and cash-movement counts are unchanged by application.
3. Full supplier credit application to its original bill, both balances reaching exactly zero and an excess application rejected.
4. Read-versus-allocate permissions, document-family denial, wrong party, incompatible sides/control accounts and cross-company targets without effects.
5. Cash-settled invoice and bill originals retaining zero outstanding while later credits remain unused.
6. Future allocation/unapply boundaries, a future credit source and linked-reversal state with generic reversal identity masked from a sales-only reader.

Read options execute in `BEGIN READ ONLY` transactions and are compared against before/after source, journal, sequence and side-effect evidence. Fixtures use untaxed earned services and ordinary expenses, so this test does not establish tax recoverability, deferred-revenue credit basis or every original-line cap. Those concerns belong to the source-selection/cumulative-cap verifier and broader canonical story acceptance. Browser controls, deployment and external providers are separately verified.

## Verified execution

On 2026-10-09, root normally installed reviewed migrations 0093 and 0094, reaching 93 migration files. The verifier then passed **all six grouped scenarios**, without failures. `node --check`, scoped ESLint and `git diff --check` passed as well. No implementation or installed-migration change was required by this run.

The customer fixture posts a `40.00` credit against a `100.00` invoice. Concurrent identical-key `30.00` applications return the same receipt and create exactly one allocation, audit event and idempotency receipt. Credit residual becomes `10.00` and original residual `70.00`; later replay adds no effects and a changed payload with the same key conflicts. The supplier fixture applies a `100.00` credit to its `100.00` bill, reaching `0.00` on both sides.

For both customer and supplier originals already settled by a cash document, a later `40.00` credit remains unused and options report `original_settled` with `0.00` application capacity. The future-boundary fixture retains today's `40.00` credit and `100.00` invoice residuals, but an existing future `30.00` application limits new capacity to `10.00`; a still-later unapply only restores the higher capacity at the correct date.

Retained fixtures:

- Company: `9b9493d3-a73c-41c9-a8f9-6dd3edcb71cd`.
- Invoice: `3bf5d5af-3314-4d7f-8e57-c0c9e84b42af`; customer credit: `76979ed7-b4bb-43b6-91bb-04a94fd62f7a`.
- Bill: `e01fe67a-598d-4152-b41b-623b631f9a96`; supplier credit: `28104211-73db-4e2c-a314-e1a0710feddd`.

The log is retained in batch evidence as `accounts-batch3/validation/credit-application-database.log`. These are six grouped database checks, not six fully completed canonical story acceptance cases. The privileged fixture setup and the provider/tax/deferred/browser limits above remain applicable.
