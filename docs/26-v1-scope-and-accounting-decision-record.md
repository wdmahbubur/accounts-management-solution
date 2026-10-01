# US-001 — V1 Scope and Accounting Decision Record

**Status: DRAFT — owner and independent accountant approval is pending.**

This record makes the proposed V1 baseline reviewable. It does not approve policy, provide tax/legal advice, authorize production use, or replace the source specification. The original source documents remain authoritative and unchanged. Any approved deviation must identify the affected source rule and receive a separate reviewed decision.

## Source baseline

- Product scope: [docs/README.md](README.md), [product requirements](01-product-requirements.md)
- Accounting policy: [accounting rules](02-accounting-rules.md)
- Database and authorization contracts: [database design](03-database-design.md), [API contracts](06-api-contracts.md)
- Acceptance evidence: [acceptance and delivery](07-acceptance-and-delivery.md)
- Baseline version: AMS V1.0, 29 September 2026

## Decisions submitted for review

Every item below is transcribed or summarized from the source baseline. “Proposed” means the documents describe a candidate V1 rule; it is not evidence of owner or accountant approval.

| ID | Proposed decision | Source / review question | Status |
| --- | --- | --- | --- |
| D-001 | V1 serves Bangladesh service and non-stock SMEs. Books are accrual and BDT-only. Each organization holds one legal company's separate books; a login may belong to multiple companies without consolidated ledgers. | README scope; confirm product boundary and legal-company model. | Pending owner approval |
| D-002 | V1 excludes inventory costing, payroll, foreign currency, statutory filing, and autonomous AI posting. | README scope and product requirements; confirm exclusions. | Pending owner approval |
| D-003 | Recognize earned/incurred activity independently of cash. Drafts and approvals have no ledger effect. A posted source and its balanced journal, open items, allocations, audit, and outbox commit atomically. Posted facts are immutable; corrections use linked dated events. | Accounting rules AR-01–AR-04 and product requirements; confirm the proposed recognition and correction model. | Pending accountant approval |
| D-004 | Use exact decimal arithmetic, canonical money strings at API boundaries, BDT, and the source-defined rounding rules. The 10% examples are arithmetic fixtures only and are not a Bangladesh tax rate. Do not enable statutory output without independently verified rules. | Accounting rules, sections 2 and 10; confirm calculation and rounding policy. | Pending accountant approval |
| D-005 | Preserve the source-defined starter chart and mapping classifications for receivables, payables, advances, cash, tax, retained earnings, opening suspense, and rounding. Never fill a missing mapping with suspense or a balancing account. | Accounting rules, section 3; confirm each mapping and report classification against representative cases. | Pending accountant approval |
| D-006 | Revenue is recognized when earned; unperformed prepaid services remain deferred. Expense and supplier obligations follow accrual recognition. Opening balances retain party-level AR/AP detail; mid-year cutover YTD summaries enter annual reports once, without recreating historical revenue. | Accounting rules, sections 4–8; confirm recognition judgments, cutover treatment, and report presentation. | Pending accountant approval |
| D-007 | Treat input-tax recovery as conditional on an approved recovery policy. Keep zero-rated, exempt, and out-of-scope labels distinct. Do not claim local compliance from illustrative examples. | Accounting rules, sections 2–4; determine whether any tax treatment is approved for implementation and identify the reviewer evidence. | Pending accountant/tax review |

## Decisions intentionally unresolved

These are recorded as open questions, not defaults. No approval is inferred from this record.

| Topic | Current evidence | Decision owner / evidence needed | Status |
| --- | --- | --- | --- |
| Final brand and launch wording | Not selected in source baseline. | Product owner decision. | Open |
| Final pricing, trial duration, included seats, storage, and packaging | No validated price or commercial promise exists. | Product owner evidence from pilot validation. | Open |
| Billing and email providers | Provider contracts and operational controls are not selected. | Product and security review of provider terms, credentials, webhooks, and data handling. | Open |
| Retention, privacy, residency, deletion, and export terms | Source requires approval before launch; retention periods are not specified. | Owner/legal/privacy review with an evidence-backed policy. | Open |
| Pilot organizations and data | First three pilot organizations and permitted pilot data are not selected. | Product owner and participating organizations; no real customer data in development fixtures. | Open |
| Operating budget and deployment region | Not decided. | Product and operations decision with cost and residency evidence. | Open |

## Required decision record to complete this gate

The authorized reviewers must update this record or attach a signed decision that includes:

1. Product owner name, role, decision date, and approved scope/exclusions.
2. Independent accountant name, qualification/role, decision date, and explicit approval or requested changes for mappings, recognition, cutover, and report presentation.
3. Tax reviewer identity and evidence for any jurisdiction-specific treatment enabled. If none is approved, tax rates and compliance claims remain disabled; the 10% fixture remains illustrative only.
4. Each deviation from the source baseline, its rationale, affected requirements/rules, and separate review outcome.
5. The disposition of every unresolved topic above, or a statement that it remains out of launch scope pending a named owner and due date.

| Reviewer | Name and role | Decision | Date | Evidence / comments |
| --- | --- | --- | --- | --- |
| Product owner | **Pending** | Not approved | **Pending** | **Pending** |
| Independent accountant | **Pending** | Not approved | **Pending** | **Pending** |
| Tax reviewer, if applicable | **Pending** | Not approved | **Pending** | **Pending** |

## Implementation and verification boundary

This document does not mark US-001 complete. The application must still demonstrate the approved policy through its owning implementation stories and acceptance cases, including T-17, T-38, T-39, and T-50. A source document, AI-generated summary, green technical check, or issue label is not a human approval. Do not close US-001 or unblock dependent work until the required named reviews and evidence are recorded.
