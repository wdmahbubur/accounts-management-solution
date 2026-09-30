# Server boundary

US-004 establishes one shared organization-command execution path for mutations.

- `auth/` verifies server-side identity and resolves live active membership through
  a trusted membership port. Browser-supplied actor/role/org claims are never used.
- `commands/execute.ts` owns authorization, request metadata, validation entry,
  canonical request hashing and stable error normalization.
- Route Handlers use `createOrganizationRouteHandler`.
- Server Actions use `createOrganizationServerAction`.
- Both adapters invoke the same `OrganizationCommandDefinition.execute` handler;
  they must not duplicate posting or authorization logic.

US-004 does **not** implement login/recovery, role administration, posting,
idempotency persistence or other financial command behavior. Those remain in
their owning stories. Until a command supplies a trusted live-membership resolver
and its domain/database implementation, it must not be exposed as a mutation
endpoint.
