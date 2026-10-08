# Company setup implementation verification — 2026-10-08

Implementation commit: `61f87c5c900a1ba55183833c6b37c8453f3f2937`, from `fix/company-setup-completion` based on `21fb782`. Final PostgreSQL verification ran from integrated commit `f361c990352ab5025dcae4aa68cdda4685584c9b`.

Application checks (setup worktree, then combined integration):

| Command | Outcome |
| --- | --- |
| `npm run lint` | Passed, no warnings |
| `npm run typecheck` | Passed |
| `npm test` | Setup worktree: 159 tests passed, no skips or failures (11 new setup tests); integrating agent reports 184 combined tests passed |
| `node --conditions=react-server --test tests/application/company-setup.test.ts` | Independently reviewed: 11 passed |
| `git diff --check` | Passed |

Final database command from the integrated root worktree: `node --env-file=../ams-setup-worktree/.env.local --conditions=react-server scripts/test-company-setup.mjs`, using explicitly named isolated test URLs. The runtime principal was `ams_app_login`, non-superuser, no RLS bypass, no role-create. No additional role privileges were granted. The exact installed RPC metadata query and value serializers were used.

**Final SQL verification passed:** all nine grouped scenarios passed with exit code 0 after the integrating agent clean-installed all 88 migrations through 0089 in the isolated synthetic Neon database. Final 0086 SHA256: `4b99267e23960cce90659feb4069aee8c6c6e83feb99e332b2ae2e611c7b8c32`. This run includes the final dedicated opening-save `accounting.read` requirement. No applied migration checksum was changed in place. The earlier pre-final run is superseded by the results below.

Full command output: `/workspace/scratch/151774994d72/accounts-audit/validation/company-setup-final-2026-10-08.log`. No credentials are included in this evidence.

| Scenario | Evidence / transaction boundary |
| --- | --- |
| Explicit zero choice, receipt replay, mismatched key conflict, no journal, no later opening | Actual restricted runtime; rolled back |
| Atomic opening source + evidence, failed summary rollback, replay after approval, stale version, approved AR import, one balanced 100.00 journal, correct party open item | Actual restricted runtime; rolled back |
| Cross-company owner, missing identity, unavailable opening source | Actual restricted runtime; rolled back |
| Missing AR mapping blocks readiness and activation | Privileged fault-injection fixture; live function actor checks retained; rolled back |
| Stale approved digest causes complete rollback of status, completion, journal and idempotency receipt | Privileged fault-injection fixture; live function actor checks retained; rolled back |
| Immutable evidence UPDATE/DELETE rejection and non-owner Admin denial | Privileged fixture; live function actor checks retained; rolled back |
| Concurrent same-key zero choice | Two actual restricted connections; identical receipts, one completion audit, no journal |
| Concurrent different-key zero choice | Two actual restricted connections; one completion, one 23514 conflict, no journal |
| Concurrent approved opening sources | Two actual restricted connections; one completion, one 23514 conflict, one journal |

Race fixture organizations retained only in the isolated synthetic DB for cross-connection visibility:
`e56d9519-70a3-4a19-a38d-0a77279586af`, `e1ef61be-5fa5-4a5c-81e6-625141b9e454`, `3d639247-ff79-420f-8a7e-56fdd27eb405`.

The independent review found and the implementation corrected: inconsistent cutover-read permissions, loss of recovered form values after a definitive retry error, missing account/party identity in opening review, and generic UI entry points bypassing the atomic workspace. Read-only review of the integrated shared-page diff confirmed the cash agent's parallel document permission gates and receipt allocation props were preserved.

No browser claim is made by this worktree. Root owns combined build/browser verification. Arbitrary overdue historic open-item migration remains outside this change; see ADR 0003. This is evidence for this setup transition, not all product acceptance cases or production deployment.
