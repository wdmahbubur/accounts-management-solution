# AI execution guide

## Purpose and source precedence

Use GitHub stories to implement one verified slice at a time. This guide adds execution instructions; it does not change the original v1.0 product/accounting specification. Read `../AGENTS.md` first, then `README.md`, product requirements, accounting rules and the selected story. Read the source UI/API/database sections named by that story. Resolve conflicts by a reviewed decision record; story wording is not authority to weaken ledger or security invariants.

## Choosing the next story

Open `10-implementation-roadmap.md` or the master GitHub tracker. Read the live issue and its comments. Check every linked prerequisite is merged with the required evidence. Milestones group delivery gates; individual story dependencies give the executable graph. Do not sort blindly by GitHub number. An issue marked closed without its tests or required human sign-off is still a blocker. Initial `status:ready` / `status:blocked` labels are planning snapshots and are not automatically maintained.

US-001 is the owner/accounting decision gate. US-002 is the reproducible toolchain bootstrap. Infrastructure work that does not depend on approved accounting policy may proceed in parallel; tax/recognition behavior must not silently assume approval. US-021 proves the first real-database accounting slice before daily finance expansion. Cross-cutting approval and private-file stories intentionally appear early even though their epic numbering is later.

## Working procedure

Read current code, environment examples and test scripts before changing anything. Start a focused feature branch. In the issue or PR, state the intended change, exact acceptance scope, touched tables/commands/screens, and planned negative tests. Implement contracts and database/domain behavior before connecting financial UI. Reuse shared posting, permissions, calculations and reporting services. Add migrations through the selected toolchain and test both fresh and upgrade installation in isolated databases.

Test incrementally, then run the complete required checks. Use genuine independent database connections for race tests. The T-01..T-52 and S-01..S-20 cases describe implementation requirements, not already-passing tests. Include real-role authorization tests, failed/partial transactions, retries and historical dates. Add browser evidence for screen behavior. Provider, performance, pilot and recovery tests require their real environment and measured evidence; label missing checks honestly.

Open a PR referencing the story and source contract. Include exact commands, outcomes, changed schema, screenshots when relevant, rollback implications and remaining limitations. Only use `Closes #N` when the work actually satisfies that issue. Do not close an epic or dependent story merely because one related PR merged. Update initial readiness labels/checklists as work changes; no automatic dependency system is installed by this handoff.

## Definition of done by work type

For a database/domain story: reviewed migration, tested invariants under runtime roles, negative and concurrency cases where specified, typed command contract and no tenant bypass. For a UI story: real command integration, permission-safe data, loading/empty/error/conflict states, accessible controls, correct totals and browser tests. For an operational story: reproducible sandbox or recovery run, safe secrets, retry/failure proof and an operator runbook. For a professional-review/discovery story: named approval, scenarios, unresolved decisions and a separately scoped implementation plan; never fabricate human sign-off.

## Test/report honesty

Initially the repo contains no application scaffold. The provided 35 Python reference tests cover selected arithmetic/ledger examples; the 24 static checks examine artifact consistency. Neither executes the SQL or proves the future application secure. Preserve this distinction in every PR. US-085 is the full real-application acceptance gate; US-086 records measured load results; US-087 requires three authorized pilots and independent review. Creating these issues does not complete any of those gates.

## Data and deployment boundaries

Use synthetic fixtures by default. Do not commit customer documents, access tokens, secrets or personally identifiable pilot data. Do not run the reference SQL against an existing/live project. Keep company evidence private and backups of object bytes separate from database-only recovery. A deploy or real payment is not implied by permission to implement a story. Never roll back a schema by restoring old books over newer committed transactions.

## Reusable AI work request

```text
Repository: https://github.com/wdmahbubur/accounts-management-solution
Implement GitHub issue #<number> only.
Read AGENTS.md, the issue, its prerequisites, and the linked source specification first.
Verify prerequisite code is merged and required tests/reviews passed. Do not bypass blockers.
Inspect existing code and propose the smallest complete implementation slice.
Implement contracts, database/domain guards, API and applicable UI; preserve unrelated work.
Add/run the story's acceptance, authorization and concurrency tests as applicable.
Open a focused PR with exact commands/results, schema changes and remaining limitations.
Do not claim unrun tests, fabricate human approval, deploy production or execute payments.
Do not close the issue until all acceptance criteria and review gates are satisfied.
```

For US-089..US-100, replace “Implement” with “Complete the discovery PRD”; those issues do not authorize feature implementation.

## Keeping the handoff current

`backlog.json`, `issue-map.json` and `user-stories/` capture the initial publication. GitHub discussions and merged code contain subsequent progress; these files are not a background sync. Update documentation deliberately when approved contracts change, retain source provenance, and record amendments instead of silently overwriting the original accounting policy.
