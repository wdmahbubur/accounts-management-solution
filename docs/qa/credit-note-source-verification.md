# Credit-note source selection and cumulative limits

Date: 2026-10-09. Scope: the bounded source-selection and accounting-cap portion of [US-038 / #54](https://github.com/wdmahbubur/accounts-management-solution/issues/54) and [US-040 / #61](https://github.com/wdmahbubur/accounts-management-solution/issues/61). This evidence does not mark either complete story accepted.

## Changes

- `database/migrations/0093_credit_note_source_options_and_caps.sql` adds a permission-checked original invoice/bill read model and a private shared capacity calculation.
- `apps/web/server/documents/credit-notes.ts` validates and parses exact decimal strings and tenant/party/source scope. The GET endpoint is `documents/credit-options` beneath the existing organization API.
- Customer sources require `sales.read`; supplier sources require `purchases.read`. Reads do not call write-only document options or expose posted journals, cash accounts or allocation data.
- Source summaries carry immutable issued party names. Selected sources include the original issued party snapshot, original line pricing/discount/account/cost center/tax snapshots, and dated remaining quantity/net/tax/gross/header amounts.
- Existing original tax snapshot triggers remain authoritative. The cap guard also enforces original account/cost-center/tax basis. Quantity, price and discount may be explicitly adjusted within the approved original quantity and value bounds; the system does not invent discount proration.
- Drafts and approvals reserve no credit capacity. Posting serializes against the original document row and checks capacity before accounting effects. Save checks the final saved line/header totals before success. Both hooks are narrow, single-match patches to the existing routines; existing accounting, authorization, approvals, period locking and idempotency remain in place.
- Capacity is the original amount minus peak cumulative usage from the proposed date through every future credit/reversal boundary. A posted reversal releases its credit from the reversal date. Duplicate original-line references aggregate, and the full header total includes rounding.
- Known literal guard errors map to useful form fields. Unknown SQL details retain the existing generic error; raw database text is not sent to the form.

## Repository checks

Core implementation commit: `428613918a323361561ee1cd6f3bc31fcca9d1bf`.

| Check | Result |
| --- | --- |
| `node --conditions=react-server --test tests/application/credit-note-options.test.ts` | 9 passed, 0 failed/skipped |
| `npm run typecheck` | Passed |
| Scoped ESLint on service, route, allowlist, contract and test files | Passed |
| `node --check tests/database/credit-note-sources.mjs` | Passed |
| `git diff --check` | Passed |
| Real database verifier | 12 groups passed |

The application tests cover exact immutable DTO parsing, source/party/company/date mismatch rejection, module permission checks before RPC, bounded/malformed responses, unavailable sources, and safe exact-literal error mapping. They do not substitute for the database tests below.

## Actual restricted-role database verification

Runner: `tests/database/credit-note-sources.mjs`. Run only with `AMS_DATABASE_TESTS=isolated`, `TEST_DATABASE_URL` and `TEST_DATABASE_RUNTIME_URL`, after migration 0093. The test validates matching database targets and actual `ams_app_login`, uses native Node WebSocket and a 30-second connection timeout, and requires two runtime connections for the posting race.

```bash
AMS_DATABASE_TESTS=isolated node tests/database/credit-note-sources.mjs
```

The final run used the explicitly authorized isolated Neon database. Root had applied 0093 normally via the migration runner; the installed migration was not edited during testing. Test URL aliases were mapped privately from the ignored root configuration; values are not recorded here.

Privileged fixture setup created unique synthetic identities, memberships, roles, contacts, tax versions and cost center, and directly activated only the synthetic companies. Every tested source read, source save, approval, posting and reversal ran under the actual restricted login. Privileged read queries inspected private audit/outbox/idempotency evidence without broadening runtime grants. Successful synthetic fixtures are retained; expected failures and read-only transactions roll back. No production or retained browser fixture was changed.

| Group | Observed result |
| --- | --- |
| Restricted login and fixtures | Actual direct login has no superuser, BYPASSRLS, database/role creation, direct ledger insert or private capacity-helper execute privilege. |
| Customer/supplier reads | Module-only readers receive exact source values and labels; wrong module, document-only role, outsider, wrong company/party, unknown source and direct private helper calls are denied without effects. |
| Real tenant boundaries | An actor owning two synthetic companies cannot select or mix the other company's actual posted source, party or original line. |
| Immutable history | Live contact edits plus archival/replacement of the original tax version leave issued party snapshot, source amount/version/digest and original tax basis unchanged. |
| Partial credit posting | Both customer and supplier credits post exact complete balanced journals; proposed newer tax code/mode does not replace the original tax snapshot. |
| No draft reservation | Multiple drafts and an approved credit do not consume capacity; editing the same draft does not self-count. |
| Line caps and basis | Excess quantity/value, duplicate-line totals, independently rounded line tax, wrong parent/party and account/cost-center changes fail atomically. |
| Header rounding | Two individually permitted positive adjustments cannot make cumulative credits exceed the original total including rounding. |
| Original eligibility | Future-dated, reversed and inactive-party originals are unavailable. The pre-existing contact history guard also rejects removing a used customer role. |
| Temporal capacity | A reversed 60.00 credit followed by a future 70.00 credit uses a peak of 70.00, not 130.00. A backdated extra 40.00 fails; 30.00 posts. Reversal restores capacity from its effective date. |
| Concurrent posting and replay | Two actual runtime connections post separate approved 60.00 credits against a 100.00 original. Exactly one succeeds. The loser stays approved with no journal or post event. Same-key replay has no further effects. |
| Final invariants | Original issued source remains unchanged and every committed synthetic journal is balanced. |

Successful run: `40028293-107e-4bb5-8963-3285ff2297c9`.

| Synthetic evidence | ID |
| --- | --- |
| Main organization | `c1a4f586-ed1b-4a0f-a836-bef14365783b` |
| Foreign organization | `8d9e26cb-3be2-49d1-b76d-a4bc3fc079eb` |
| Original invoice | `58167b32-e0f6-48dc-94f6-bcc022828c2a` |
| Original supplier bill | `819a5e95-e4d7-47a2-bb60-e00ea58ef41b` |
| Customer partial credit | `c95fdaa1-9c6c-444b-9ef7-d3dc9067fd94` |
| Supplier partial credit | `943cd099-9add-41ec-ab6a-45a9fc3c4e9a` |
| Temporal original | `0140d907-2c37-4163-84e4-e67afc64c817` |
| Concurrent original | `30290186-2059-4f92-8db2-44777cef56c7` |

The local evidence log is `accounts-batch3-credit-sources-third.log` in the shared scratch parent. Two earlier isolated runs stopped at verifier assumptions, not an implementation failure: the existing tax trigger returns `P0002` for a supplier line used in a customer credit, and the existing contact history guard prevents removing a used role. Their synthetic organizations (`fa7661c2-2767-4848-af40-60244d8eedb3`, `53d05da3-3482-42c6-adea-1d44893bec91`) remain separate from the successful fixtures. The final runner asserts both existing protections.

## Boundaries and remaining verification

- Browser selection, partial-quantity interaction and page preload/recovery are integrated by the UI/root slices; this document records database/service verification, not browser acceptance.
- Applying a posted credit to an original open item remains the existing allocation command, with a separate 0094 read/UI slice and verifier. Credit draft allocation payloads are not added here.
- Deferred-revenue customer credits still require the separately reviewed earned/unearned allocation policy. This change keeps them unavailable rather than inventing that accounting treatment.
- Original source reversal after any posted credit child remains subject to the existing reversal dependency rules, including the pre-existing restriction after a child credit itself has been reversed.
- Full integrated build/CI, PDF/email behavior and production rollout are outside this isolated verifier. No schema reset, accounting-history rewrite or external delivery occurred.
