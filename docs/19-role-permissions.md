# US-009 capability roles and owner floor

## Source mapping

The role table in `docs/01-product-requirements.md` is implemented conservatively.

- The source specification defines 39 capability codes. The implemented vocabulary
  has 41: US-026 adds `dues.adjust` for controlled subledger adjustments, and
  US-063 adds `approvals.manage` for approval-policy administration. These are
  story-scoped extensions recorded by migrations 0027 and 0023, respectively;
  the original v1.0 source document remains unchanged.
- Owner receives all 41 implemented capability codes.
- Admin receives company/user administration only and no default financial read.
- Finance manager receives the unambiguous finance/posting/approval/report scopes, including the explicit reopen capability.
- Accountant receives finance/posting/report scopes but not optional approval-decision or delegated period-lock/reopen defaults.
- Billing is the explicitly delegated sales scope. Broad `dues.read` and `contacts.read` are excluded: customer and AR reads use the existing `sales.read` row-level policies; a billing operator cannot read vendor-only contacts or AP open items. It does not receive `documents.read`, `banking.read`, `accounting.read`, `ledger.read`, `reports.read`, purchase read or audit read.
- Auditor is read-only and receives the evidence/report/accounting reads needed for drilldown.

Cells labelled Optional, Delegated, Requires review, or No-by-default are not silently promoted to default grants.

## Custom roles and grant authority

Custom roles are organization-local and cannot masquerade as system templates.

Role-management mutations require:
1. verified `auth.uid()`;
2. live active membership;
3. `users.manage`;
4. recent sign-in within the existing 24-hour sensitive-action window;
5. the organization-wide role-admin transaction lock.

An active Owner can grant any documented capability. A non-Owner manager may only create or assign roles whose permission set is a subset of that manager's current live capabilities. Self role changes are rejected.

## Last-owner protection

All supported role, deactivation and ownership-transfer mutations serialize on the same organization advisory lock and recheck authority after acquiring it.

Owner-role removal and active-membership deactivation also have database triggers that reject a zero-owner result. Ownership transfer first grants Owner to the active target and only then removes Owner from the current actor.

The independent race harness starts two authenticated Owner sessions that each try to remove the other. Exactly one mutation may succeed; the other fails after the lock/recheck and the organization retains one active Owner.

Administrative superuser/direct-service SQL remains operationally privileged as documented by the repository security contract; ordinary authenticated callers have no direct role/member DML grants.

## Audit

Successful custom-role, role-assignment, deactivation and ownership-transfer routines append `finance.audit_events` with the verified member actor and request correlation ID.

## S-03 status

Billing's live capability set is tested and excludes broad P&L/AP/private-bank/document permissions. The actual P&L, AP and vendor-evidence feature endpoints are later stories, so S-03 is tracked as partial rather than claiming nonexistent endpoint tests.

## Application boundary and UI

`/o/[organizationId]/settings/users` and `/o/[organizationId]/settings/roles`
use verified identity, live membership and `users.read` before any management data
is rendered. Server Actions and the `/api/v1/organizations/[organizationId]`
roles/member/ownership routes use the same typed command definition and
`users.manage` check. Database routines independently derive the actor and repeat
authority checks. No browser-supplied actor, role claim or editable Auth metadata
is authoritative.

Mutation requests carry the current company nonce. A company switch invalidates
an old form, including an A-to-B-to-A switch. API reads return private/no-store
responses and company pages are dynamic. Custom-role editing shows only
permissions the current manager can grant; direct calls remain independently
checked. System templates are read-only. Assignment, deactivation and ownership
transfer have explicit pending, validation, forbidden and conflict feedback.
Deactivation and transfer require confirmation. Invitation lifecycle is US-010,
not a simulated form in US-009.

## Verification layers

- `tests/application/role-management.test.ts`: typed validation, shared command
  execution, forged authority denial, read/mutation separation and sanitized errors.
- `supabase/tests/database/06_role_permissions.test.sql`: template seeds,
  bounded grants, metadata resistance, custom roles and ownership changes.
- `supabase/tests/database/07_role_scope_boundaries.test.sql`: real authenticated
  Billing queries against populated customer/vendor, AR/AP, bank, ledger and
  source fixtures; denial of management and direct writes; direct owner-floor
  guards; transfer, revocation, recent-auth and verified audit identity.
- `scripts/test-role-race.sh`: separately tests role removal and deactivation,
  proves two distinct blocked PostgreSQL backend sessions before release, and
  requires exactly one success while preserving one active Owner.
- `tests/browser/role-management.spec.ts`: real local Auth, custom-role editing,
  membership changes, stale tenant context, direct API escalation attempts,
  removed permissions, ownership transfer, deactivation and responsive screens.

These are test definitions, not a claim of successful execution. Consult the PR's
final head-specific CI evidence for executed results. Later P&L and vendor-file
application endpoints remain outside this story and S-03 remains partial.
