# SaaS billing boundary - paid activation deferred

The owner explicitly deferred paid billing on 21 October 2026 and will supply approved paid plans and limits. Existing company tenancy, memberships and accounting authorization continue to define access. This change does not invent prices, currencies, seats, trials, grace periods, an unlimited-free offer or automatic expiry rules.

`apps/web/server/billing/adapter.ts` defines the provider boundary for checkout, customer portal and raw-body webhook verification. The only installed adapter is `disabled`. Missing `BILLING_PROVIDER` selects it; `BILLING_PROVIDER=disabled` is the explicit configuration. Any other value fails configuration instead of silently activating or selecting a provider. No billing credentials are currently required, and no provider network calls occur.

The subscription page and API require live `subscription.read` authority. They expose the current company subscription summary and actual active-member count, without private provider identifiers or billing-event payloads. No plan row is seeded. The checkout command also requires `subscription.manage`, trusted origin, current company context and an idempotency key. It returns `409 BILLING_DISABLED`; browser-supplied plans, prices or entitlement authority cannot activate anything.

`POST /api/v1/webhooks/billing/[provider]` deliberately returns `503 BILLING_DISABLED`. It never parses the payload, accepts an activation, writes an event, changes entitlements or posts a tenant journal. This is an explicit unavailable endpoint, not a pretend successful webhook integration. T-45/T-46 remain deferred.

Before installing a real provider adapter:

1. Record the owner's approved plans, billing currency/amounts, feature and seat limits, trial/grace/downgrade and read/export policy. Resolve approved plans from a server-owned catalog, never a browser price or success redirect.
2. Select and verify the provider's actual sandbox account, supported regions and sender/legal/business configuration. Keep sandbox and production credentials separate and server-side.
3. Verify raw bytes/signatures, merchant account/environment, event identity and freshness. Bind provider subscription/customer identifiers to stored company records; do not authorize a company from user-editable metadata.
4. Add the guarded transactional event/entitlement processor with unique provider event receipts, safe retries and provider-specific ordering/reconciliation. Never apply subscription charges to customer-company GL.
5. Enforce approved seats and expiry at the authoritative transaction boundary, including invitation races, without interrupting a posting halfway, deleting books or making accounting/security invariants premium-only.
6. Replace the disabled public handlers only with these controls in place, then run actual sandbox duplicate/out-of-order/tampered-signature/tenant tests. Obtain separate approval for production credentials, migrations, deployment and real payments.

The small application runtime pool now allows two simultaneous connections so concurrent layout, authentication and command reads do not all queue behind one connection. Worker concurrency remains one. Every checked-out runtime connection still sets actor identity inside its own transaction; the real HTTP test runs Owner/Billing/nonmember reads concurrently and verifies their distinct authorization results. This is consistent with Neon's [small per-container pool guidance](https://github.com/neondatabase/website/blob/main/content/docs/guides/serverless-connection-pooling.md), and is not the declared large-dataset performance benchmark or an uptime guarantee.
