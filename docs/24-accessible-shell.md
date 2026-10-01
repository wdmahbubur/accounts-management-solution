# US-082 — Accessible company shell and shared finance components

The dynamic company layout validates the explicit organization, current company
nonce, verified session and live membership, then sends only the active company
summary and current actor capabilities to the client shell. The shell is keyed by
organization and nonce so local component state is not reused for another company.
Navigation shows only implemented, authorized destinations; hiding a link is never
a substitute for each destination/command's independent authorization. Persistent
Next.js layouts are not an authorization boundary; protected pages and commands
continue to resolve current identity and membership on every server request.

The responsive shell provides a skip link, company switcher, breadcrumbs, visible
session identity/sign-out and offline/read-only notices. Financial components are
disabled offline, and a shared interaction boundary disables financial editing in
a read-only company. Nothing queues financial mutations offline. A lost session
returns to sign-in on the next protected server navigation; no prior-company
financial dataset, JWT or draft is persisted in browser storage by this story.
Existing domain-owned drafts must be reloaded after reauthentication with fresh
permissions and source version. No new financial draft-persistence/recovery system
is claimed by this UI-only library.

## Reusable patterns

- MoneyInput is a controlled text/decimal keyboard input with exact two-decimal
  validation, not an HTML number or binary-float calculator. Empty/invalid values
  never silently become zero. MoneyCell groups canonical string digits without
  losing cents above JavaScript's safe-integer range. Unicode labels remain text.
- Account/party pickers consume scoped minimal options, including empty and stale
  company states. Run `pickerData` on the server before serializing props, using an
  already authorized scoped query. Never send all-tenant or forbidden data to a
  hidden client component. The projection helper is not an authorization query.
- The controlled draft line table preserves quantity/price strings and delegates
  edits/removal to the domain form. It does not total, approve or post a document.
- PostingPreview renders only server-provided versioned rows/totals. Loading,
  error and forbidden states do not display zero as a fake financial balance.
- Native modal audit/confirmation dialogs have accessible names, keyboard focus
  behavior and return focus after cancellation. Audit entries must be authorized
  before serialization. Read-only or forbidden audit data must never be passed
  to the browser, regardless of whether the drawer button is visible.
- ConfirmAction accepts the caller's existing stable request key. A synchronous
  in-flight latch prevents double invocation. Success and uncertain responses
  disable further confirmation for that instance. Reconcile the operation before
  remounting: never mint another key after a timeout. The caller/domain still
  owns durable idempotency and transaction verification; this component cannot
  make a non-idempotent server safe.
- Date-range filters and textual status badges use labeled controls and do not
  rely on color alone. Shared feedback separates empty, loading, failure,
  forbidden, stale conflict, offline and read-only outcomes.

## Verification and deployment

The real browser suite exercises keyboard selection, native modal focus/Escape,
precise Unicode input, date/money errors, offline/read-only disabling, duplicate
invocation and uncertain-result blocking. Actual Auth/company routes exercise
role-sensitive navigation, context switching, session loss and direct API denial.
Existing S-05/S-15 browser and API guards remain part of the complete CI suite.

`/internal/ui-fixtures` contains synthetic component examples only and returns 404
unless AMS_UI_TEST_HARNESS=1. Only the isolated Playwright server enables the flag.
A separate production-runtime HTTP smoke test verifies the route is 404 when the
flag is absent. Do not set that flag in a deployment. No customer records, keys or
financial posting endpoints are present on the fixture page. Screenshots include
real application shell flows and explicitly synthetic component patterns; they
are not evidence of future financial feature implementation.

No database migration, hosted configuration or production deployment is changed.
Rolling back these presentation components must retain current server-side access
checks. Browser/CI evidence is recorded against the final tested PR commit; an
accessible implementation is not claimed to be an independent accessibility audit.
