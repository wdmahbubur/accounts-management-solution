# Database and file recovery — 21 October 2026

## Scope and release boundary

Implements a synthetic rehearsal for [US-079 #96](https://github.com/wdmahbubur/accounts-management-solution/issues/96) and supplies evidence to [US-085 #99](https://github.com/wdmahbubur/accounts-management-solution/issues/99). Base candidate: `4fc3fc7461bef92209d0c5def61f683b2f4a320d` (PR #182). This work is stacked on that open PR. No production migration, merge/deployment, payment, or external email was performed.

The source was the existing isolated Neon E2E branch, whose scheduled expiry was removed to retain the rehearsal. A separate retained recovery branch was created at **21 October 2026 00:22:38.096 Asia/Dhaka**. A new synthetic identity marker committed at 00:23:45 is absent from the recovered database. The original source was preserved.

Live provider observation: PostgreSQL 18.6, AWS US East 2, Free plan and a **six-hour database history window**. These are observations, not an approved production backup/retention or service-level policy.

## Database restoration

`scripts/recovery-database.mjs` captured a repeatable-read, read-only baseline and compared the historical restore. **All 69 application tables matched**, including identity, accounting, audit/outbox, report/close and private-artifact metadata. Migration history through 0101 (100 files), three ledger groups, policies, grants/RLS attributes, routines, triggers, constraints and runtime-role memberships matched. The baseline had 13 journals and one issued PDF; no referenced attachments, completed-export, staged-import, bank-import or report-object files were present.

The recorded restore action began at 00:23:54.355. The successful verification log was written at 00:25:33: approximately **99 seconds** for this database branch creation and verification. The selected point preceded the action by approximately **76 seconds**. This intentionally selected historical point and small synthetic dataset do not demonstrate an automated production RPO or combined service RTO.

Private manifests and exact operational configuration are retained under ignored `output/recovery/2026-10-21/`; only sanitized evidence is committed. The manifest is verification evidence, not a standalone database backup.

## Independent file recovery and discovered defect

The PDF's original local bytes were backed up independently and checked against its immutable database SHA-256/size. They were restored into a **private bucket on the recovery branch**, using actual Neon S3 operations and the application's normal restricted-login PDF/download code.

The first access-revocation exercise exposed PostgreSQL **42703**: `finance_private.invalidate_member_invitations()` still referenced `identity.users.email`. That prevented member deactivation. Inspection found the related invitation routines also retained old provider identity columns.

Forward migration **0102** repairs four existing functions to use `email_normalized` and `disabled_at`. It retains empty definer search paths, capability checks, recent-auth requirements, invitation snapshots, cooldowns and restricted grants. It changes no tables, posted facts or issued PDF metadata. It was applied only to the recovered test database; fresh installation through 0102 also passed (101 migration files).

After the repair, the provider/file suite passed **8/8** (seven nested checks plus the parent):

- Database-only restore cannot serve a missing object.
- Independently restored bytes match the original PDF digest and ID.
- An unsigned provider request is denied.
- Actual provider corruption is rejected; restoring original bytes recovers the same issued version.
- Foreign-company, anonymous, nonmember, missing-capability and invalid-path access is denied.
- A new reader can download before deactivation and is denied afterward with the same actor; deactivation uses the public command.
- Pending/quarantined metadata is denied before fetching bytes.

The test compared financial source/journal/movement/open-item/allocation/PDF fingerprints before and after; all stayed unchanged. New synthetic membership/quarantine fixtures are retained. No actual antivirus result is claimed. File test execution took **63.1 seconds**, including deliberate missing/corrupt-object and access-denial scenarios; this is not a combined incident RTO.

## Invitation regression evidence

The separate actual-database suite passed **8/8** (seven nested checks plus parent): verified/normalized recipient binding; hidden token hashes; unverified/wrong-recipient denial; resend cooldown and superseded-link rejection; one-time acceptance of the snapshotted role; disabled/unverified issuer denial; inviter deactivation canceling links and queued delivery; foreign-role/private-helper/self-deactivation denial; and rejection of an invitation whose role permissions changed after issuance. Mail recipients are synthetic and no delivery provider was invoked.

## Commands and outcomes

```text
node scripts/recovery-database.mjs capture <private-baseline.json>                         PASS
node scripts/recovery-database.mjs verify <private-baseline.json>                          PASS
node scripts/db-migrate.mjs (explicit recovered-target environment; upgrade through 0102)  PASS
node scripts/db-migrate.mjs (new empty isolated database; through 0102)                    PASS
node --conditions=react-server --test tests/database/recovery-files.test.mjs                8/8
node --conditions=react-server --test tests/database/invitation-security.test.mjs           8/8
node --conditions=react-server --test tests/application/recovery-guards.test.mjs            1/1
npm run lint                                                                               PASS
npm run typecheck                                                                          PASS
npm test                                                                                   331/331
npm run build -- --webpack                                                                 PASS
git diff --check                                                                           PASS
```

All operational commands used explicitly selected isolated hosts and private environment profiles; no credentials are included here. The public runbook is [database-file-recovery.md](../operations/database-file-recovery.md). Sanitized logs are in [evidence/recovery-2026-10-21/](evidence/recovery-2026-10-21/).

## Remaining gates

This rehearsal does not complete #96/#99 or authorize a public launch. Funded/approved production retention and independent object-backup scheduling, incident ownership, full report/close and worker crash/replay acceptance, complete T-01–T-52/S-01–S-20 coverage, load tests, billing-provider sandbox verification, and required release decisions remain separate gates. The full accounting/security suite is being executed next; passing application tests are not substituted for those results. No professional accountant/security certification or real customer pilot is claimed.
