# US-009 capability roles and owner floor

## Source mapping

The role table in `docs/01-product-requirements.md` is implemented conservatively.

- Owner receives the complete 39-code documented permission family.
- Admin receives company/user administration only and no default financial read.
- Finance manager receives the unambiguous finance/posting/approval/report scopes, including the explicit reopen capability.
- Accountant receives finance/posting/report scopes but not optional approval-decision or delegated period-lock/reopen defaults.
- Billing is the explicitly delegated sales scope. It does not receive `documents.read`, `banking.read`, `accounting.read`, `ledger.read`, `reports.read`, purchase read or audit read.
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
