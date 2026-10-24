# Production country/currency release — 24 October 2026

The owner explicitly authorized a production backup, required migrations, PR #188 and dependency merges, deployment to Vercel, and live Edge setup tests. This record supersedes the production-not-deployed status in the dated [21 October candidate report](company-country-currency-2026-10-21.md); independent worldwide launch reviews remain open.

## Released versions

- PRs **#182–#188** are merged into the existing release branch, `fix/clean-workspace-ui`. Each merge preserves the exact previously tested #188 tree, `ed323a2feaea8116c23c82e016d0cca8d440cbc5`. Initial release commit: `12e2df2e037724f16b29fdcfa1a835c86dc4d1b6`.
- Live invoice-form testing found a remaining hardcoded taka symbol in shared amount formatters. **PR #189** fixes numeric presentation in drafts, document details, previews and credit-source amounts, and labels the rounding limit with the selected company currency. Grouping, signs, exact decimal digits and six-place saved unit prices are retained. No accounting calculation, grant, schema or issued file changes.
- Final production commit: **`cb97b195ca32942f346c0c446e8e7e8407fbd646`**, whose tree matches tested formatter commit `b6dc923c70320d8c127e28ad7f4d9ed8ff9595ea`.
- Vercel project `accounts-management-solution-web`, production deployment **`dpl_BgfLmqCSe9kwFKSoibXqca4W52cv`**, is **READY**. The canonical alias [accounts-management-solution-web.vercel.app](https://accounts-management-solution-web.vercel.app) resolves to that deployment. Next.js 16.4.2 / Turbopack, region iad1; final build took approximately 36 seconds and became ready at **10:41:10 Asia/Dhaka**. Five redundant intermediate preview builds were canceled to release the build queue; production builds were retained.

## Backup and migration

Neon production branch `br-delicate-smoke-b4ilnfwr` / database `neondb` started with 99 migration receipts through 0100. A new retained branch, **`backup-pr188-20261024` / `br-rapid-pine-b467gur8`**, was created at **10:08:34 Asia/Dhaka**, with auto-delete **Never**. All 69 table fingerprints, migration receipts, dated ledger groups, object metadata and security fingerprints match the source snapshot at `2026-10-24 04:08:19.460043+00`. The retained backup was compared again after the production setup tests and still matches.

Both referenced issued PDFs have independent AES-256-GCM byte backups, matched to their original SHA-256 and sizes and successfully decrypted again. There were no referenced attachment, export, bank-import, import or report-object bytes requiring an additional backup. Credentials, encryption keys, object keys, database manifests and bytes remain private under ignored `output/deployment/2026-10-24/`.

A separate child branch, `rehearsal-pr188-20261024` / `br-nameless-king-b4gf3cgj`, rehearsed the exact forward upgrade before production. It expires on **25 October at 10:10:02 Asia/Dhaka**; this does not expire the retained backup. An initial pooled-connection attempt rejected timeout startup parameters before any migration ran. The documented direct owner connection supports the timeout bounds and completed the upgrade.

**All 23 migrations, 0101–0123, applied successfully in rehearsal and production**, producing **122 canonical receipts**. SQL bytes were checked against #188 commit `65b1d5bbd667c836a1f5f09e407168c66b4f6b2a`. All 68 original non-migration table fingerprints agree immediately before/after migration. The earlier backup differs only in the expected authentication-session write from signing in for the browser test; no financial baseline exception was permitted. Four restricted-runtime company-locale reads succeed; anonymous access is denied; no broad financial DML grants were added.

After all browser tests, eight original financial table fingerprints still agree with the backup baseline: business documents, document lines, journal entries/lines, open items, settlement allocations, invoice PDF versions and report snapshots. Ledger totals and private-file metadata are unchanged. Both new synthetic companies have **zero saved documents and zero journals**.

## Live Edge results

Tests ran on the canonical production origin using the existing public demo identity, with clearly named synthetic company records. No personal customer company was modified and no invoice email or payment was sent.

- Country selector: **249** options; currency selector: **132** supported two-decimal codes. JPY and KWD are unavailable as designed.
- **US / USD / America/New_York**: review, saved-draft reload/restoration, company creation, zero opening activation and USD dashboard passed.
- **Germany / EUR / Europe/Berlin**: review, creation, zero opening activation and EUR dashboard passed.
- Switching back to the existing public demo books restores **BDT**. An old EUR URL requires fresh company selection and exposes no EUR totals under the BDT context.
- On the final formatter deployment, the USD invoice form shows USD labels and `USD 0.05` rounding limit, with no taka symbol. Keyboard input calculates **123.45** correctly. The EUR form calculates **3 × 0.335 = 1.01**, retains EUR labels and has no taka symbol. Existing BDT invoice labels and rounding limit remain correct. These inputs were never saved or posted.
- New invoice issue/accounting dates use the company-local server date. The tested current date is 2026-10-24; the earlier opposite-timezone boundary cases remain in the candidate database evidence.
- No console entries were returned for the test tab. Vercel returned no error/fatal log groups for the final deployment's 15-minute window or the initial deployment's 30-minute window. These are short observations, not an availability guarantee or a complete telemetry certification.

Programmatic fill initially changed the displayed input without its hydrated React state; actual keyboard input confirmed the USD calculation. EUR's normal validation changes the input's accessible name while a decimal is incomplete; a stable label-prefix locator completed typing and the exact final amount passed. Cached/background screenshots can lag DOM state, so DOM receipts and database checks are retained separately; images do not certify every off-screen value.

## Exact checks and evidence

Formatter implementation `b6dc923` passes `npm test` (**351/351**, no skips), `npm run typecheck`, `npm run lint`, and `node --env-file=<private-isolated-profile> scripts/run-next.mjs build apps/web --webpack`. [CI](https://github.com/wdmahbubur/accounts-management-solution/actions/runs/40063025829), GitGuardian and the Vercel preview build pass. The production deployment then builds and serves the tested code using the production environment.

Operator commands actually run:

```text
node output/deployment/2026-10-24/prepare-backup.mjs
node output/deployment/2026-10-24/migrate-verified.mjs --rehearsal
node output/deployment/2026-10-24/migrate-verified.mjs --authorized-production
node output/deployment/2026-10-24/merge-stack.mjs --authorized-merge-pr188-dependencies
node output/deployment/2026-10-24/verify-final.mjs
node output/deployment/2026-10-24/verify-post-smoke.mjs
```

Neon branch creation used Edge; Vercel deployment, canonical-alias verification and runtime log inspection used its authenticated connector. Private operator scripts/manifests remain on the operator workspace rather than publishing customer-state manifests. The [public receipts](evidence/production-currency-2026-10-24/) include migration/merge/deployment identities, application/static/build logs, browser observations and post-smoke database counts. The earlier 54 accounting/security, 11 HTTP, five currency/database and one fresh-install groups were run on isolated synthetic databases on 21 October; they were not rerun against production. Presentation-only follow-up work did not require production mutation tests.

## Continuing boundaries

One company has one immutable accounting currency. FX, mixed-currency transactions within a company and zero-/three-/four-decimal currency support remain unavailable. Paid billing and privileged support access remain explicitly deferred. Country selection supplies no statutory tax defaults or filing certification. Independent accounting/security review, country tax/legal decisions, authorized pilots, production worker/scanner scheduling, monitoring and incident ownership, approved retention/RPO/RTO and the declared large-dataset benchmark remain launch gates. This deployment does not manufacture those approvals.

After non-BDT books exist, preserve currency-aware rendering/posting when correcting a defect. Fix forward or pause the affected operations; do not deploy the old BDT-only application or restore older books over newer posted facts.
