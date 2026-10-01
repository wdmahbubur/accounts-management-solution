# US-007 Atomic Company Onboarding

US-007 creates the first complete tenant setup as one authenticated database command.

## Atomic command

`public.create_company_atomic(...)` derives the creator from `auth.uid()` and
commits these records together:

- organization;
- active creator membership;
- six sourced system role-template rows;
- creator assignment to the Owner template;
- the 29-account starter chart from `docs/02-accounting-rules.md`;
- reviewed implementation mapping keys for cash, bank, AR/AP, advances, input/output tax,
  retained earnings, opening suspense and rounding;
- the fiscal year containing the books-start date;
- a cutover opening period dated one day before books start;
- regular monthly periods from books start through fiscal-year end.

US-009 owns the detailed capability matrix. US-007 deliberately does not invent
Owner/Admin/Finance/Accountant/Billing/Auditor permission grants.

## Retry contract

Company creation happens before an organization-scoped financial idempotency row
can exist, so US-007 uses `finance_private.onboarding_requests`, scoped by
verified Auth user + idempotency key.

- same key + same normalized request → same organization, `replayed=true`;
- same key + different request → conflict;
- concurrent calls serialize on an advisory transaction lock;
- any failure rolls back organization, membership, roles, accounts, mappings,
  periods and the onboarding request together.

The client wizard stores the generated key in browser-session draft state so an
uncertain form retry does not silently create a second company.

## Starter account implementation notes

The account codes, names, types, normal sides and special accounting roles come
from the approved starter-account table. The schema requires a free-text
`report_group`; US-007 assigns implementation labels consistent with those
source classifications. These labels are not statutory classifications.

## Security

- anonymous callers cannot execute the onboarding RPC;
- caller identity is never accepted as an input field;
- only BDT is accepted in V1;
- timezone is checked against PostgreSQL timezone names;
- no role/capability payload can self-escalate the creator;
- general role assignment/removal and last-owner race protection remain US-009.

S-13 therefore becomes **partial**, not covered: onboarding guarantees an Owner
floor at creation and concurrent onboarding retry safety, while the general
role-escalation/last-owner-removal race is still pending its owning story.
