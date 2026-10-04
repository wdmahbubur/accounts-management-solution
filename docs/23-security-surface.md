# US-011 — Scoped database and API surface

The exposed Data API schemas remain `public` and `graphql_public`; neither
`finance` nor `finance_private` is exposed. Every application migration explicitly revokes default public execution and
grants its intended runtime role. Disabling automatic new-public-object grants
is an additional deployment setting; this change does not modify hosted settings. Ordinary callers cannot
create objects in public/finance/private schemas, or directly modify finance
records. Every finance base table has RLS. New migrations must retain explicit
function revokes/grants; catalog acceptance tests reject accidental anonymous
routine grants, unsafe definer search paths, raw DML or owner-executed views.

`active_tenant` resolves the actual auth.uid against active membership and a
non-archived company. Restrictive tenant fences apply in addition to existing
module-level policies. The capability helpers also reject archived companies.
Definer helpers exist only for non-recursive authorization lookups, have an empty
search_path, and never take a client-supplied actor as authority. Management
commands still derive the actor, lock, authorize, validate and audit independently.
Do not infer a financial posting guard from these read policies.

Attachment metadata now requires attachments.read and permission for EVERY linked
document. A readable sales source cannot expose an unreadable supplier evidence
filename via an additional link. Unlinked metadata requires the active uploader
and attachment read/write capabilities. Export metadata is requester-owned as well
as tenant/capability-scoped. Existing byte delivery retains its stricter clean-scan,
expiry and report-specific checks, with no reusable signed URL. Previously delivered
bytes cannot be recalled.

`finance.document_directory` is a minimal SECURITY INVOKER / security-barrier view.
It exposes only source identity, type/state, number/date and canonical money text;
underlying caller RLS remains authoritative. The public invoker RPC is cursor-paged
and bounded to 100 rows. The authenticated Next.js directory GET additionally
resolves live membership, validates inputs/outputs, rejects foreign returned scope,
and returns private/no-store responses. It is not a full sales/purchase register
or a financial report generator. Unknown or unauthorized RPC scope returns no
rows; the application boundary uses a permission-safe 404.

`ams_job_worker` is a NOLOGIN, NOINHERIT, NOBYPASSRLS, non-administrative role. It has
no company-table grants and cannot reuse human commands. Migration `0076` adds a
separate `ams_job_worker_login` identity and grants only leased outbox, report
export, reminder and private-file cleanup routines to the worker role; those job
procedures validate organization/job identity and fencing tokens. The app uses `DATABASE_WORKER_URL` for internal
workers and checks that it targets the same database as `DATABASE_RUNTIME_URL`.
`DATABASE_RUNTIME_URL` cannot claim, read or acknowledge background work, and the
worker identity cannot read or write finance tables directly. Local credential
provisioning uses a random secret in ignored `.env.local`; deployed environments
must supply the equivalent identity through their secret manager. Runtime
cross-tenant denial, lease races and provider delivery still require acceptance
verification.

## Verification scope

The dynamic pgTAP catalog checks cover every protected base table/view and every
non-extension public/private application routine. Ordinary Billing and Auditor
identities exercise positive reads before AP/ledger/report-cache/evidence/export
and cross-tenant denials. Tests attempt forged metadata and direct commands,
private routine calls, archived-company reads, live removal, and an intentionally
broad permissive policy under the restrictive tenant fence. Anonymous and worker
roles are exercised independently. Browser integration uses real Auth and
PostgREST JWTs plus the Next.js directory route, verifies finance/private schemas
are not exposed, and checks removal with the same still-valid token.

Existing S-02 composite-FK tests, owner/invitation races, direct form/API guards,
company-switching and real Storage-byte tests remain in CI. The complete future
P&L, posting, account-cycle/classification, uploads and worker implementations must
extend S-01..S-07 and DB-G05/17/18 in their own stories; a synthetic persisted fixture
or cached report record does not demonstrate those generators are implemented.

The CLI-generated additive migration tightens access, creates one invoker view and
one default-denied worker identity; no accounting facts are rewritten. Prefer a
forward fix or disable a route rather than rolling back to permissive grants.
AI technical review is distinct from independent security/accountant/pilot sign-off.
