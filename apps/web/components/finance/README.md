# Shared finance UI

Use `components.tsx` for exact-string money inputs/display, server-scoped account
and party options, controlled draft lines, server-provided posting previews,
audit/confirmation dialogs, dates/status and explicit loading/error/conflict states.
`FinanceInteractionBoundary` disables financial edits for a read-only company;
components also disable changes offline. These are not posting commands.

Read `docs/24-accessible-shell.md` before integrating. Authorization must happen
before props are serialized, not by hiding buttons. Keep the caller's stable
request key across uncertain results and reconcile before enabling another action.
