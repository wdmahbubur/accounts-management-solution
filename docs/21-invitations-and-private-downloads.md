# US-010: invitations and live private-download authorization

## Invitation contract

An authorized, recently signed-in company administrator selects a recipient email
and an explicit role they may grant. Issuance produces a cryptographically random
256-bit, URL-safe token. Only its SHA-256 hash is stored on the invitation; even
ordinary users.read queries cannot select that hash. Links expire after 72 hours.
The verified recipient email is read from Auth's authoritative user record, not
client metadata or an unverified JWT email claim. Inspection discloses company and
role only to that recipient. Acceptance/rejection consumes the invitation once.

Create/resend/revoke and acceptance share the organization access-management
lock. Acceptance re-reads the invitation after acquiring that lock and checks
current issuer membership, grant authority, role capability snapshot and expiry.
Self-invitation, foreign roles and role escalation are denied. A changed role
requires an authorized resend with a new snapshot; old links stop working. Resend
is limited to once per minute per invitation and 20 issue/resend events per hour
per organization. A repeated accept cannot add another membership or role.
Rejoining an inactive member retains their historical identity but replaces old
roles with exactly the newly approved role. Member removal invalidates pending
invitations from that issuer and pending links to the removed recipient.

Management APIs use the organization command boundary, exact configured public
Origin and current company-context nonce. The recipient response has no existing
company context requirement but still requires a verified session and same-origin
mutation. Tokens, encrypted envelopes and internal SQL errors are never logged in
audit data. Invite pages are no-index and no-referrer; reverse-proxy and application
observability must redact `/invite/*` paths, request bodies and response receipts.

## Delivery and deployment

`INVITATION_DELIVERY_KEY` is a server-only, random 32-byte AES-256-GCM key encoded
as 64 hexadecimal characters. Generate it securely per environment; never prefix
it with NEXT_PUBLIC_, commit it, or expose it to the browser. Missing/invalid
configuration fails issuance closed. Set `NEXT_PUBLIC_APP_URL` to the actual
browser-facing origin for each environment (see document 20).

The transactional outbox stores an authenticated encrypted token envelope, bound
to organization, invitation ID and token hash. Revoke/resend/accept/reject purge
superseded delivery envelopes. The authorized issuer sees a one-time share link
in the mutation receipt; list/read endpoints cannot retrieve it later. UI says
queued, not sent. Real email-provider delivery and retry execution belong to
US-082; they are not claimed by this story. A future delivery worker must recheck
pending state, generation, hash, live issuer and expiry immediately before sending,
use this exact server key and idempotent provider delivery, and purge ciphertext
when finished. Rotate keys only after draining or revoking/reissuing pending
invitations; silently discarding the old key would strand queued envelopes.

## Read-only private artifact boundary (S-14)

`ams-private-artifacts` is a private bucket with a 10 MiB maximum object size.
Paths are exactly `<organization>/attachments/<id>` or
`<organization>/exports/<id>`. Authenticated Storage byte GET operations must
satisfy current metadata and live membership/capability checks. Listing, signing
and public access are not granted. A restrictive bucket-specific SELECT fence
prevents another broad policy from granting bearer URLs or cross-tenant access.

Evidence must be marked clean and have a valid size. Every linked document must
be readable, so linking the same object to an allowed AR invoice cannot disclose
an unreadable AP bill. An unlinked object is limited to its active uploader with
both attachment read/write permissions. Exports must be completed, unexpired,
owned by the requesting active member, and authorized for exports.read,
reports.export, reports.read, accounting.read and ledger.read. This initial
allowlist supports only trial_balance; other export types fail closed until their
owning implementation adds and verifies the precise report-specific predicate.

The application's download handler verifies the identity, requests authorized
metadata, fetches Storage bytes using that user's JWT (never a service key), and
rechecks authorization after the fetch. Responses are attachment downloads with
sanitized filenames, octet-stream content type, nosniff and private/no-store.
A removal or capability reduction blocks the next request even while the same
JWT remains valid. No reusable signed download URL is issued. Already received
bytes or a response already authorized and in flight cannot be recalled; no
zero-latency revocation claim is made for that unavoidable boundary.

Upload/scanning pipelines and report/export generation remain US-068/US-071.
Synthetic completed-artifact fixtures test the real byte-delivery boundary; they
do not demonstrate those generators or upload pipelines are implemented.

## Verification and migration operations

The actual pinned CLI produced migration
`20261001073607_invitations_and_revocation.sql`. It adds invitation lifecycle
columns, revokes unsnapshotted legacy pending invitations, and records that
invalidation in audit. Existing accepted memberships and audit identities remain.
Apply only through the reviewed migration path. Do not roll back by restoring an
old database or making the private bucket public; prefer a forward fix and disable
issuance/download routes when a compatible application rollback is needed.

`08_invitations.test.sql` exercises actual ordinary authenticated database roles.
`test-invitation-race.sh` observes two independent connections waiting on the same
access-management lock, then checks one success, one consumed-token denial, one
membership, one role and one acceptance audit. Unit tests cover authenticated
encryption and command boundaries. The browser test uses actual Auth, forms,
API requests and synthetic bytes in private Storage, with positive read controls
before wrong-tenant, scan, permission, expiry and revocation denials.

Execution results are recorded against the final PR commit; test definitions
alone are not evidence of passing. Accountant, independent security and pilot
sign-offs are separate gates and are not supplied by these technical tests.

Official Storage references consulted for the operation-aware boundary:
- https://supabase.com/docs/guides/storage/schema/helper-functions
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/serving/downloads
