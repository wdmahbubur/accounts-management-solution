# Database and private-file recovery runbook

Use an isolated, synthetic environment for rehearsals. Production restoration or deployment needs separate explicit authorization. Application rollback must retain newer committed books; restoring an old database over them is not an application rollback.

## Prepare

1. Identify the incident owner, selected release SHA/schema, provider project/branch, separate restricted runtime/worker identities, and a new recovery target. Record the actual history window and backup retention. Obtain approved operational RPO/RTO and retention/budget decisions; provider defaults are not guarantees.
2. Stop writers to the synthetic source while capturing the baseline. Keep migration-owner credentials outside the web runtime. Store credentials, manifests and object bytes privately outside Git.
3. Set `AMS_DATABASE_TESTS=isolated` and `AMS_RECOVERY_SOURCE_HOST` to the explicitly selected source hostname. `DATABASE_URL` must identify that isolated source. The verifier refuses the currently known production endpoint, including its unpooled alias.
4. Capture a consistent read-only baseline:

   ```text
   npm run recovery:database -- capture <private-baseline.json>
   ```

   This records SHA-256 table fingerprints/counts, dated ledger totals, migration checksums, private-file metadata, and authorization/constraint/trigger/routine fingerprints. It does not create a database backup. Preserve the actual provider recovery point or a separately validated database backup as well.
5. Independently back up every referenced private-object byte stream. Validate each digest and size against its database metadata; include clean and quarantined attachments, issued PDFs, completed exports and any staged/import/report files needed for resumed work. A digest manifest alone cannot restore bytes. A missing referenced object is a blocker. Preserve filename/key mapping and quarantine state. Do not trust an object ETag as the application's SHA-256 digest.

## Restore to a separate target

1. Record recovery start time. Create a new database branch at the selected historical timestamp/LSN using the provider's documented recovery operation. Never reset production for a rehearsal. Retain the source and recovery evidence until the drill is reviewed.
2. Point `RECOVERY_DATABASE_URL` and `AMS_RECOVERY_TARGET_HOST` to the new target; keep `AMS_RECOVERY_SOURCE_HOST` set to the original source. Run:

   ```text
   npm run recovery:database -- verify <private-baseline.json>
   ```

   All baseline table fingerprints, migrations, ledger groups and security definitions must match. A deliberately created post-point synthetic marker should be absent. On a mismatch, investigate the recovery point or incomplete restoration before running migrations or workers.
3. Restore file bytes independently into a private bucket on the isolated recovery branch. Compare SHA-256 and byte size. Prefer missing-object conditional writes; do not replace an existing different object without investigating its provenance. Preserve issued metadata and original source snapshots.
4. Use the actual restricted application identity to download recovered files through the normal authorization and integrity-check path. Test unsigned storage access, foreign-company/nonmember/anonymous access, missing capability, live revocation, missing/corrupt bytes, and quarantine. A pending or rejected file must never be relabeled clean as a recovery shortcut. A real antivirus scan requires separate scanner/provider evidence.
5. Reconcile journals/TB, AR/AP open items and allocations, cash, statements and close/reopen evidence. Verify worker leases, stale-token denial and safe resumption/replay using synthetic jobs and an approved mail/payment sandbox. Do not let restored queued work deliver to real recipients unintentionally.
6. Measure the selected recovery-point age and time to verified usable service. Record dataset size and scope, operator/engineering/user pauses, unavailable checks and actual outcomes. Do not convert one small synthetic drill into a production availability or capacity promise.
7. Verify forward migration compatibility and fresh installation separately. Preserve the baseline match result before applying a repair to the recovered target. A repair can legitimately change routine fingerprints; it must not rewrite posted financial history.

## Reproducible file/access test

`npm run test:database:recovery` executes an intentionally destructive **synthetic-object** test against a dedicated private `ams-recovery-drill` bucket. It removes/restores and corrupts/restores only the one selected synthetic issued PDF on the separate target. It refuses production and the source host. Never use this command as a general production restore utility.

Required private environment: isolated `DATABASE_URL`/`DATABASE_RUNTIME_URL`, `AMS_TEST_DATABASE_HOST`, `AMS_RECOVERY_SOURCE_HOST`, `AMS_RECOVERY_STORAGE_HOST`, `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`, `AWS_REGION`, existing storage credentials, `AMS_RECOVERY_MANIFEST`, and `AMS_RECOVERY_BACKUP_DIR`. The known source PDF must be available under the local private-object root with its original key and digest. Provider endpoint, bucket and baseline must be reviewed before execution. A storage credential grants no user permission to download through the application.

The test seeds only new synthetic identity/membership/quarantine fixtures. File reads use the real runtime login; membership removal uses the public command. Quarantine is an authorization fixture, not a fabricated antivirus result. No external mail or payment is sent.

References checked for this drill: [Neon branch management](https://neon.com/docs/manage/branches), [Neon Object Storage](https://neon.com/docs/storage/overview). Neon storage forks with branches, but this procedure still verifies separate object backups and restored bytes rather than assuming database recovery proves object recovery.
