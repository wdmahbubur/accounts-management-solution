# AI implementation contract — Accounts Management Solution

## Current delivery policy

The owner's delivery-policy amendment is recorded in [roadmap #115](https://github.com/wdmahbubur/accounts-management-solution/issues/115), dated 3 October 2026. AI is responsible for V1 implementation, accounting-focused software review, code/security review, testing, fixes, integration, documentation and release work. Routine internal project reviews do not require an additional human signature or an independent human accountant. Required review evidence is an explicitly labelled AI review with findings and test results, not professional certification.

Use this amendment instead of older human-only delivery gates in initial story templates, PR descriptions and handoff documents. It does not waive implementation requirements, required tests, accounting invariants, product transaction approvals, access controls or platform protections. It does not modify credentials, repository protections or deployment permissions.

## Start here

The repository began as a specification and backlog; inspect live branches, merged code and current verification evidence rather than assuming the original publication describes today's implementation. Read `docs/README.md`, `docs/01-product-requirements.md`, `docs/02-accounting-rules.md`, `docs/03-database-design.md`, and `docs/10-implementation-roadmap.md`. Then read the selected GitHub issue, its comments, canonical scope, dependencies, applicable UI/API sections and linked acceptance cases. `docs/11-ai-execution-guide.md` describes the working procedure.

The source specification is v1.0 dated 29 September 2026. Original product/accounting documents retain their provenance. If source documents conflict, record an explicit decision, perform an AI accounting/technical review and test the chosen behavior; do not quietly invent accounting policy. The delivery-policy amendment changes review ownership, not the source accounting contract. The approved scope is BDT-only accrual books for Bangladesh service/non-stock SMEs. One organization is one legal company's separate books; users may have multiple memberships, not consolidated ledgers.

## Execute one bounded story

1. Inspect live issue state, comments, current code and actual prerequisite PRs. Issue numbers and labels are not substitutes for verified dependency completion. Follow consolidated issues to their canonical owners; duplicate closure is not implementation. Select a requested or dependency-ready V1 story; post-V1 issues authorize discovery only.
2. State scope and validation plan. Work on a focused branch named `feat/us-NNN-short-title`, `fix/...` or `docs/...`. Preserve unrelated changes. Never force-push a shared branch or rewrite financial history.
3. Implement shared contracts and domain/database checks first, then the UI. Inspect existing implementation rather than generating a parallel ledger or duplicate service layer.
4. Run actual repository checks and record exact commands, candidate commit, outcomes, skips and limitations. Reference Python/static checks do not establish application, PostgreSQL, RLS, race, browser, provider or restore correctness. Lint, typecheck and build alone do not establish feature acceptance.
5. Perform distinct AI accounting and code/security review passes as applicable. Challenge the implementation using source requirements and independently derived expected outcomes. Use separate reviewer agents when available; otherwise label separate review passes honestly. Record findings, fixes and rerun results; never claim an unavailable agent or a human review took place.
6. Open a focused PR with acceptance evidence. Integrate verified work through the repository's available workflow and mark complete only after full canonical scope, prerequisites, required tests and AI review are satisfied. No additional human project reviewer is required, but platform-enforced protections remain binding. Do not auto-close dependent or epic issues merely because files exist.

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

The application's maker-checker and transaction approval rules remain required features. Removing human delivery signatures does not remove these business controls or authorize an AI to post customer transactions autonomously.

## Security and operations

No secret/service-role keys in clients, logs, commits or sample data. Do not trust user-editable metadata for roles. Do not grant broad financial DML to bypass missing routines. Use restricted private objects and permission-checked downloads. Test tenant/capability boundaries under ordinary roles, not only administrative credentials. Workers must remain organization-scoped and retries must not repost financial activity. A scanner selection is not a verified scanner integration; pending/error/infected evidence remains inaccessible.

Back up and rehearse recovery of both database records and object bytes. Application rollback must not overwrite newer committed books. AI may prepare and carry out release work through configured, authorized project tooling after the evidence-based gates in #115 pass. Record target, commit/version, compatible migration/rollback procedure, actual deployment result and post-deployment smoke checks before claiming a release. No additional human accountant signature is an internal release prerequisite.

Missing access, credentials, provider capability or test infrastructure must be reported as concrete limitations. This policy does not change platform permissions or permit bypassing protections, executing customer payments, purchasing services, exposing private data, signing contracts or destructive resets of financial data.

## AI decisions and evidence

US-001 uses an AI-reviewed scope/accounting decision record under the owner's documented direction, not a pending human-signature queue. Resolve bounded technical choices in dated decision records with rationale, assumptions and verification. AI accounting review is software validation, not a licensed accountant's certification, statutory audit or legal sign-off. Tax-rate examples remain illustrative, not statutory defaults; use current authoritative sources before making statutory claims. Do not invent prices, legal terms, provider verification, customer use, performance measurements or test success.

US-087 uses three isolated synthetic-company rehearsals operated by AI in place of the mandatory human-operated pilot/signature gate. Record them as synthetic rehearsals, never real customer pilots. US-088 records the AI release assessment and actual release evidence. The original story index is historical; apply the dated #115 amendment to internal review ownership while retaining functional scope and traceability.

## Toolchain and tests

Inspect the active branch's package scripts, migration tooling and architecture decisions; do not assume a superseded provider or test harness is the current runtime. Verify current official documentation for the selected stack when implementing changes, and pin compatible dependencies plus lockfiles. The reference SQL is not a production migration; implement and test DB-G01–DB-G18 in their owning stories.

Retained reference/artifact checks are:

```bash
cd docs
python -m unittest discover -s tests -v
python verification/check_spec.py
```

The second command rewrites its generated static-check JSON. Do not confuse these checks with T-01..T-52 and S-01..S-20, which require evidence against the actual application. Run the relevant application, database, ordinary-role security, independent-connection race, browser, provider, performance and recovery checks. The owner requests testing as part of AI-led completion; prior deferred-testing notes are not evidence that tests passed or permission to close untested work.

## Completion report

State: issue/PR, changed modules, schema changes, exact checks/results, AI review findings, unresolved risks, integration/release status, and what is explicitly not implemented or verified. Evidence beats assertions. Keep documentation and the issue's actual progress consistent with merged code. Do not label a documentation-policy update as a completed product, accounting certification or deployment.
