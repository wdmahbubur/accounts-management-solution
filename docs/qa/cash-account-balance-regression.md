# Cash-account balance serialization regression

## Scope

`read_cash_accounts` returned `"0"` for a newly configured account without
ledger entries. The cash-account page requires an exact two-decimal money
string, so the first-company bank setup succeeded and its list then failed
to render. Migration `0088_cash_account_balance_decimal_contract.sql` casts
the aggregate through `finance.amount` before converting it to text. It
preserves the existing permission check, tenant joins, posted-entry filter,
ordering and function grants. The UI parser remains strict.

## Real database regression

Apply the committed migrations to an isolated test database and provision its
verified synthetic public demo. Configure only that database's restricted
application connection as `DATABASE_RUNTIME_URL` in the private local setup.
The test requires a fresh active demo without a manual-journal approval policy.

```bash
AMS_DATABASE_TESTS=isolated npm run test:database:cash-accounts
```

The explicit flag prevents this test from running as part of the normal
application suite or accidentally connecting when configuration is missing.
It does not identify the provider target; select the isolated database before
running it. The runner checks the actual session role is an ordinary login
that inherits `ams_runtime`, without superuser, RLS-bypass, role/database
creation, direct ledger INSERT privileges or a `SET ROLE` impersonation.

The test uses one restricted connection and one transaction. It creates two
temporary identities and companies, and creates bank accounts through the
public setup functions. The active public demo supplies the permitted posting
context for additional synthetic chart accounts, a temporary high-threshold
approval policy and journal sources created/submitted/posted through the
ordinary public functions. No trigger, grant or posting gate is disabled.
All fixtures, audit records and postings are rolled back in `finally`.

| Case | Required result |
| --- | --- |
| New bank with no ledger | `book_balance` is exactly `"0.00"`, matching the empty cashbook |
| Company isolation | The account list contains only the requested company's account |
| No actor | SQLSTATE `28000` |
| Actor from another company | SQLSTATE `42501` |
| Foreign cash-account ID in an authorized company's cashbook | SQLSTATE `P0002` |
| Saved, unposted journal source | Balance remains `"0.00"` |
| Large posted debit | Exactly `"9007199254740991.99"` |
| One-cent posted credit | Exactly `"9007199254740991.98"` |
| Bank credit exceeding that balance | Exactly `"-0.02"` |
| Settled balance | Exactly `"0.00"` |

Every balance is compared with the cashbook RPC. Deferred database constraints
are forced before rollback, so the posting fixtures must satisfy the existing
source/journal consistency checks. This regression tests the database contract;
it does not replace the separately captured authenticated browser journey.

## Executed evidence

After migration 0088 was applied to the isolated Neon database, the command
above passed all six tests (five cases and their parent), with no failures,
skips or cancellations. The role guard passed for the actual restricted
connection. All expected money strings and denial SQLSTATEs in the table
were observed, deferred constraints passed, and the final rollback completed.
No production database, posted customer history or browser session was used.

The same command passed again after a clean installation of the final combined
88 migrations through 0089 on 2026-10-08: six tests passed, zero failures or
skips, using the unchanged 0088 migration and actual restricted login. The
combined application check also passed all 184 tests, lint, typecheck and build.
