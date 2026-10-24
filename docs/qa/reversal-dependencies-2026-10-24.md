# Effective source reversal dependencies — 24 October 2026

Scope: [bug #175](https://github.com/wdmahbubur/accounts-management-solution/issues/175), under source reversals #43 and integrated acceptance #99. Implementation: `98ccb9d445f6bac4fc0f3a657dd343b722cb5021`, completed by **`666c69588a248cb5bffa42d902302c1a75fad3ed`**. This is an isolated release candidate, not a production migration/deployment receipt. Production remains `cb97b195ca32942f346c0c446e8e7e8407fbd646`.

## Change and accounting review

Forward migrations **0124–0125** replace only known anchors in existing guarded routines. Reversed bank matches remain in history but no longer prevent source reversal. Active matches still require removal; finalized evidence still requires authorized reopening. Source reversal takes the existing organization bank-evidence lock after its year/period/source locks. A competing new match cannot attach to an already reversed source.

A posted child credit, refund or advance application remains a dependency until its own posted reversal is effective on/before the proposed source reversal date. An already-recorded future reversal does not release an earlier date. The same-day boundary is allowed. No original document, journal, match, allocation, issued snapshot or migration receipt is rewritten. Grants, number allocation, opposite-journal construction, historical capacity checks, capability checks, idempotency, audit and outbox paths are retained.

The command adapter now returns `REVERSAL_DEPENDENCY` with date/correction guidance instead of reporting a credit/refund dependency as a locked reconciliation. The client releases editable fields after this confirmed rejection and retains its safe request key. Reversal date help correctly refers to company timezone. Reversal counterparties use the neutral “Issued contact” heading, including supplier reversals.

AI accounting/security implementation review: both customer and supplier controls are exercised; original journals remain equal to their pre-reversal rows; historical control bridges stay zero; duplicate and competing commands cannot append duplicate money; active/finalized and future-dated dependencies continue to deny. Ordinary logins cannot read the private outbox or call private posting helpers. This is an AI review, not independent accountant/security or legal sign-off.

## Actual checks

The private source profile selects `ams_clean_launch_20261021`; a separate newly created database is `ams_launch_corrections_20261024`. Both use restricted runtime logins and synthetic records. Their final schema has **124 canonical receipts through 0125**. No production test target or existing database was reset.

| Check | Result and version |
| --- | --- |
| Final reversal regression, upgraded database | **10/10 passed**, no skips, at `666c695`; active/finalized/partially/all-reversed matches, both credit types, both refund types, earlier/equal dates, replay and four two-connection race scenarios |
| Final reversal regression, new database | **10/10 passed**, no skips, at `666c695`; same restricted-role cases |
| General accounting/security/concurrency suite | **54/54 passed**, no skips, after 0124 / `98ccb9d`; exact tax/rounding, golden reports, approvals, tenant isolation, period/year locks, races, deadlock/serialization retries and real process death after commit |
| Advance/refund lifecycle | **7/7 passed**, no skips, after 0124; customer/supplier applications, linked refunds, opening advances, capacity and checker/race protection |
| Actual Auth.js HTTP | **13/13 passed**, no skips, after 0124; real password sessions, direct API denial/revocation, export/finalization, bank-history reversal replay and earlier child-credit date rejection |
| Identity/company | **27/27 passed**, no skips, after 0124; verification issuance/consumption races, invitations, login limiter across processes, cash/bank split and USD accounting/private outputs |
| File/worker combined command | **15 passed, 1 failed**, no skips. Exports, issued snapshots, finalization, renderer failure, missing-file recovery and a killed SMTP worker/reclaimed lease passed. The legacy restored-file fixture refused this profile because its manifest company has no synthetic owner here; this is not a passed restore drill |
| Application | **352/352 passed**, no skips; final error mapping/client recovery included |
| Final static/build | `npm run lint`, `npm run typecheck`, optimized webpack build: **passed** at `666c695` |

Exact commands and complete logs are in the [evidence index](evidence/reversal-dependencies-2026-10-24/README.md). General suites precede the final narrowly scoped 0125 date guard; the final ten-case suite runs after both migrations on both targets. Neither static checks nor a fresh install is presented as production/provider recovery evidence.

The initial new bank fixture was invalid because a receipt requires an allocation plan; it was corrected to allocate an actual posted invoice before exercising bank dependencies. Customer/vendor credit blockers were reproduced before 0124. Initial `node --run` wrappers failed the explicit isolated-target guard; accepted runs use `node --env-file=… --test` directly. A retained `MIGRATION_DATABASE_URL` initially selected the existing isolated database during fresh-install preparation; the new target was verified empty, the override corrected, and all 123 files through 0124 actually installed before 0125. The 0125 operator check verified all prior canonical/legacy receipts and unchanged document/journal/open-item/allocation fingerprints before committing on each isolated target. No guard was weakened to make a test pass.

## Edge observations

In the user's Edge browser, actual password login opens the synthetic **Launch corrections 24 Oct** USD company. An active bank match blocks receipt reversal with correction guidance. Through the reconciliation UI, the last match is reversed with a reason; both retained matches then show **0 active / 2 reversed**. Posting the receipt reversal succeeds and links back to the original. An invoice reversal on 19 January is denied when its child credit reversal is dated 20 January; changing the date to the 20th succeeds. The supplier bill also reverses after its vendor credit is reversed.

Independent restricted-runtime readback confirms **11 posted journals / 22 lines / debit = credit = 860.00**, all three original sources still posted, exactly one reversal each dated 20 January, and both historical match rows retained. Separate read-only owner inspection confirms one reversal outbox receipt per source; runtime outbox SELECT remains denied. On 19 January AR/AP are 60.00/60.00; on 20 January AR/AP are 100.00/0.00; all four subledger/control differences are zero. [Visually inspected Edge proof](evidence/reversal-dependencies-2026-10-24/edge-reversal.png) shows the posted supplier reversal, USD amount, preserved original link, date and issued supplier contact.

Production read-only smoke checks also now load the previously reported demo General Ledger query (#179), including an empty From date, and legacy company setup (#178). Those issues are not closed by this limited check: their full width/error-retry acceptance matrices were not rerun. The local correction tests use `next dev`, not an optimized local server. The earlier automatic approval rejection of `next start` was respected. Several direct local browser navigations exceeded the browser command timeout; normal workspace links completed, and the server recorded successful responses. These timings are not a capacity benchmark.

## Remaining work and release boundary

Billing and privileged support access stay deferred and disabled by the owner's instruction. They are not counted as failed features that must be built for this slice.

This pass identified a reproducible scanner asynchronous-response failure (clean content stayed quarantined) and a new moderate Nodemailer advisory; these require separate focused fixes. Historical overdue opening dates (#174), dormant/fully reversed year closing (#176), protected production worker/scanner scheduling, monitoring/backup operations, measured load, and independent pilot/accounting/security/jurisdiction review remain separate launch work. A combined file command's incompatible historical restore fixture is recorded as a failure, not relabeled as a successful recovery exercise. The real production backup/rehearsal already completed on 24 October remains recorded [separately](production-country-currency-2026-10-24.md).

Production migration/deployment authorization has not been inferred for 0124–0125 from the earlier #188 authorization. Rollback must preserve newer committed books; retain this evidence and use a reviewed forward routine repair or disable the affected command. Do not restore an older database over newer journals. This PR does not certify worldwide launch readiness or close its parent acceptance/release issues.
