# AI implementation contract — Accounts Management Solution

## Start here

This repository initially contains a specification and backlog, not a working accounting application. Read `docs/README.md`, `docs/01-product-requirements.md`, `docs/02-accounting-rules.md`, `docs/03-database-design.md`, and `docs/10-implementation-roadmap.md`. Then read the selected GitHub issue, its dependencies, applicable UI/API sections and linked acceptance cases. `docs/11-ai-execution-guide.md` describes the working procedure.

The source specification is v1.0 dated 29 September 2026. Original documents are retained verbatim. If source documents conflict, record an architecture decision and obtain the appropriate owner/accountant review; do not quietly invent accounting policy. Story summaries do not override the source accounting contract. The approved scope is BDT-only accrual books for Bangladesh service/non-stock SMEs. One organization is one legal company's separate books; users may have multiple memberships, not consolidated ledgers.

## Execute one bounded story

1. Inspect live issue state, comments, the current repository and actual prerequisite PRs. Issue numbers and labels are not a substitute for verified dependency completion. Select only a requested or ready V1 story; post-V1 issues authorize discovery only.
2. State scope and validation plan. Work on a focused branch named `feat/us-NNN-short-title` (or `fix/...`). Preserve unrelated changes. Never force-push a shared branch or rewrite financial history.
3. Implement shared contracts and domain/database checks first, then the UI. Inspect the existing implementation rather than generating a parallel ledger or duplicate service layer.
4. Run actual repository checks and record exact commands, commit SHA, outcomes, skips and limitations. Reference Python/static checks do not establish application, PostgreSQL, RLS, race, browser, provider or restore correctness.
5. Open a focused PR referencing the story. Link all acceptance evidence. Mark complete only after prerequisites, implementation, required verification and relevant human reviews are satisfied. Do not auto-close dependent or epic issues just because files exist.

## Financial invariants — non-negotiable

- Posted journals must be balanced, complete and agree with their source. Commit source state, journal, open items, allocations, audit and outbox in the appropriate atomic transaction. Drafts have no ledger effect.
- Use exact decimal calculations and money strings at API boundaries. Never make JavaScript binary floats the accounting authority.
- Validate company identity through composite foreign keys, live membership and module/capability checks. A user belonging to two companies still cannot mix their records. UI hiding is not authorization.
- Never update/delete posted accounting facts. Correct with linked, dated credit/refund/adjustment/reversal commands; preserve original evidence.
- All financial paths, including allocations, unapply, imports, backdating and reversals, enforce period/year locks with the documented concurrency protocol.
- Open items must reconcile to control accounts. Allocate only compatible opposite items and validate capacity at every historical effective-date boundary, not just today. Reversal evidence is append-only.
- Recheck approved source version, material digest, allocation targets and current authorization at posting. Material changes invalidate approval.
- Idempotent retries and different-key races must not duplicate a source journal, document number or money event.
- Reconciliation associates statement evidence with existing cash lines; it does not post duplicate money. Finalized matches and close snapshots are protected.
- Reports derive from the authoritative ledger and dated subledger. Keep cash versus accrual, advances versus revenue, and transferred versus untransferred earnings distinct.

## Security and operations

No secret/service-role keys in clients, logs, commits or sample data. Do not trust user-editable metadata for roles. Do not grant broad financial DML to bypass missing routines. Use restricted private objects and permission-checked downloads. Test tenant/capability boundaries under ordinary roles, not only administrative credentials. Workers must remain organization-scoped and retries must not repost financial activity.

Back up and rehearse recovery of both database records and object bytes. Application rollback must not overwrite newer committed books. Production migration, deployment, real payment execution or destructive operations require separate explicit authorization. This documentation publication does not grant any of those permissions.

## Human decision gates

An AI cannot manufacture owner approval, independent accountant review, provider verification, tax/legal sign-off, pilot use or measured performance. Mark unresolved decisions blocked. Tax-rate examples in the specification are illustrative, not statutory defaults. Prices, providers, compliance claims, retention periods and commercial promises require approved evidence.

## Toolchain and tests

Bootstrap through US-002 and migrations through US-003. Verify current official Next.js/Supabase/provider documentation and pin compatible dependencies plus lockfiles before application implementation. The reference SQL is not a production migration; implement and test DB-G01–DB-G18 in their owning stories.

The only initial runnable checks are reference/artifact checks:

```bash
cd docs
python -m unittest discover -s tests -v
python verification/check_spec.py
```

The second command rewrites its generated static-check JSON. Do not confuse these checks with the 52 business and 20 security/concurrency specifications that must be implemented against the future application. Once bootstrap establishes real project commands, use and maintain those documented commands.

## Completion report

State: issue/PR, changed modules, schema changes, exact checks/results, unresolved risks, and what is explicitly not implemented or verified. Evidence beats assertions. Keep `docs/` and the issue's actual progress consistent with merged code.
