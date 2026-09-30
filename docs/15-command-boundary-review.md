# US-004 Command Boundary Review

## Scope

US-004 establishes the typed application boundary described by
`docs/06-api-contracts.md`. It does not implement financial posting, login,
role administration or idempotency persistence.

## Contracts

The shared contracts package now defines:

- UUID and organization-ID boundary types;
- canonical two-decimal `MoneyString` values;
- positive `expected_version`;
- `Idempotency-Key` and optional `X-Request-ID` parsing;
- stable documented error codes and API result envelopes;
- explicit rejection of browser-supplied actor/member/role/capability and
  organization authority fields.

Request IDs are generated server-side when absent. Material command definitions
can require an idempotency key. The command executor creates a SHA-256 canonical
request hash over operation + validated organization + validated payload, ready
for the later DB-G14 persistence routine.

## Server-side actor boundary

The shared command executor accepts the organization path segment only as an
input to validate. It derives the actor from two trusted server-side ports:

1. an identity verifier;
2. a live active-membership resolver for that verified user and organization.

The supplied Supabase identity verifier calls `auth.getUser()` and intentionally
uses only the verified user ID. It does not accept `user_metadata`, role claims
or actor IDs from the request.

A missing/invalid verified identity maps to `UNAUTHENTICATED` (401). A user
without an active membership in the requested organization maps to `NOT_FOUND`
(404) to avoid organization-membership disclosure. A valid member lacking the
command capability maps to `FORBIDDEN` (403).

The concrete production membership query is intentionally deferred to the
onboarding/role/auth stories that own that database command surface. US-004
fails closed by requiring a membership resolver dependency before a command can
be exposed.

## Shared service path

Both adapters call `executeOrganizationCommand`:

- `createOrganizationRouteHandler` for REST Route Handlers;
- `createOrganizationServerAction` for UI mutations.

Neither adapter contains posting rules. Domain behavior belongs to the command
definition's shared `execute` handler.

## Error mapping

The documented mapping is implemented:

- 401 — `UNAUTHENTICATED`;
- 403 — `FORBIDDEN`;
- 404 — `NOT_FOUND`;
- 409 — stale version, period lock and state/idempotency/capacity conflicts;
- 422 — validation/business-input failures;
- 429 — `RATE_LIMITED`;
- 500 — sanitized `INTERNAL_ERROR` fallback only. This transport fallback is
  intentionally not one of the stable business error codes.

No stack trace, SQL text or original thrown message is returned for an unknown
error.

## Guard status

**DB-G14 — foundation only.** Command context now carries operation,
idempotency key, canonical request hash, verified member ID and request ID.
Persistence/locking/replay in `finance.idempotency_requests` remains for the
transactional command story that owns actual financial effects.

**DB-G17 — foundation only.** Every command path requires verified identity,
active membership and capability. Atomic onboarding, self-escalation protection,
last-owner race protection and the concrete membership DB command remain later
stories.

## Verification intent

US-004 tests exercise the application command boundary directly:

- S-05: Route Handler and Server Action direct invocation enforce the same
  capability before the shared domain handler runs.
- S-06: anonymous identity is denied; forged actor/org/role fields from request
  payload are rejected and never replace the verified server context.
- money strings, expected versions, idempotency headers, request IDs and error
  statuses are validated behaviorally.

No browser UI exists in this story, so browser tests are not claimed.
