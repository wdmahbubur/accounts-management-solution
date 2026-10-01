# US-008 Tenant-Safe Company Context

## Authority model

The current-company cookies are navigation preferences, not authorization.

Every company page validates three independent things:

1. verified Supabase user;
2. current organization + context nonce cookie;
3. live active membership for that verified user and organization.

Changing a cookie or URL therefore cannot grant access to a company.

## Active company list

`public.list_active_memberships()` is an authenticated-only, fixed-search-path
RPC bound to `auth.uid()`. It returns only the caller's active memberships,
including organization service status and same-company role names.

Inactive memberships disappear immediately from both the company list and
`resolve_active_membership`.

## Switch invalidation

Switching writes two HttpOnly, SameSite=Lax cookies:

- `ams_current_organization`
- `ams_company_context`

The context nonce is regenerated on every switch. A form rendered in company A
is therefore stale after A → B, and remains stale after A → B → A because the
new A context has a different nonce.

`assertFreshCompanySubmission` is the shared server contract future
company-scoped Server Actions use before mutating from a rendered form.

## Cache / query / download scoping

Future company data must not share identities across tenants:

- `organizationQueryKey(org, ...)`
- `organizationCacheTag(org, namespace)`
- `organizationDownloadJobKey(org, jobId)`

The current `/companies` and `/o/[organizationId]` surfaces are explicitly
dynamic/revalidate=0, and the auth proxy marks these routes private/no-store.

No financial dashboard or export worker exists yet, so US-008 establishes and
tests the tenant-scope primitives without falsely claiming those future features
are implemented.

## S-15 status

US-008 proves with real Chromium that:

- two active memberships are listed;
- switching A → B rotates the current company;
- a previously loaded A tenant shell is rejected after the switch;
- an inactive B membership disappears immediately.

The original S-15 wording names the future finance dashboard. Until that
dashboard exists, S-15 is tracked as `partial`, not a full pass.

S-01 also remains partial because guessed source/account/file resources are
owned by later feature stories. S-02 stays covered by the real composite-tenant
foreign-key test.
