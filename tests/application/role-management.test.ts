import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { defaultRequestDependencies } from "../../apps/web/server/commands/request-context.ts";
import { parseMembers, validateRoleInput } from "../../apps/web/server/roles/contracts.ts";
import { readRoleManagement, roleCommand, roleDatabaseError } from "../../apps/web/server/roles/service.ts";

const org = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const member = parseUuid("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const user = parseUuid("11111111-1111-4111-8111-111111111111");
const role = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
function fixture(granted = ["users.manage", "users.read"]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args }); return { data: role, error: null };
  } } as unknown as Parameters<typeof roleCommand>[1];
  const dependencies = { ...defaultRequestDependencies,
    identityVerifier: { verifyIdentity: async () => ({ userId: user }) },
    membershipResolver: { resolveActiveMembership: async () => ({ memberId: member, organizationId: org, capabilities: granted }) }
  };
  return { calls, client, dependencies };
}
test("US-009 role command uses a verified actor scope and request correlation, not request authority", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({ definition: roleCommand("create", f.client),
    organizationId: org, rawInput: { name: " Sales reader ", permission_codes: ["sales.read", "sales.read"] },
    headers: new Headers({ "x-request-id": "req_role_boundary" }), dependencies: f.dependencies });
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls, [{ name: "create_custom_role", args: {
    p_organization_id: org, p_request_id: "req_role_boundary", p_name: "Sales reader", p_permission_codes: ["sales.read"]
  } }]);
  assert.ok("data" in result.body && result.body.data.roleId === role);
});
test("role commands deny unprivileged and inactive membership before making the mutation RPC", async () => {
  const f = fixture(["sales.read"]);
  const request = { definition: roleCommand("create", f.client), organizationId: org,
    rawInput: { name: "No access", permission_codes: ["sales.read"] }, headers: new Headers(), dependencies: f.dependencies };
  assert.equal((await executeOrganizationCommand(request)).status, 403);
  assert.equal(f.calls.length, 0);
  const inactive = { ...f.dependencies, membershipResolver: { resolveActiveMembership: async () => null } };
  assert.equal((await executeOrganizationCommand({ ...request, dependencies: inactive })).status, 404);
  assert.equal(f.calls.length, 0);
});
test("forged authority, unknown capabilities and unknown request fields are rejected", async () => {
  for (const extra of [{ actor_id: user }, { permissions: ["users.manage"] }, { unexpected: true }, { permission_codes: ["super.admin"] }]) {
    const f = fixture();
    const result = await executeOrganizationCommand({ definition: roleCommand("create", f.client), organizationId: org,
      rawInput: { name: "Attempt", permission_codes: ["sales.read"], ...extra }, headers: new Headers(), dependencies: f.dependencies });
    assert.equal(result.status, 422); assert.equal(f.calls.length, 0);
  }
});
test("assignment validates all role ids, deduplicates and rejects invalid input without coercion", () => {
  assert.deepEqual(validateRoleInput("assign", { member_id: member, role_ids: [role, role] }), { memberId: member, roleIds: [role] });
  for (const ids of [null, "owner", ["owner"], Array(65).fill(role)]) {
    assert.throws(() => validateRoleInput("assign", { member_id: member, role_ids: ids }));
  }
  assert.throws(() => validateRoleInput("create", { name: " ", permission_codes: [] }));
  assert.throws(() => validateRoleInput("update", { name: "Fine", role_id: "invalid", permission_codes: [] }));
});
test("DB denial, recent-auth, owner floor and unknown errors produce safe stable responses", () => {
  assert.equal(roleDatabaseError({ code: "42501" }).status, 403);
  assert.match(roleDatabaseError({ code: "42501", message: "recent authentication required" }).message, /Sign in again/);
  assert.equal(roleDatabaseError({ code: "23514" }).status, 409);
  assert.equal(roleDatabaseError({ code: "23505" }).status, 409);
  assert.equal(roleDatabaseError({ code: "28000" }).status, 401);
  const unknown = roleDatabaseError({ code: "XX000", message: "SECRET SQL password details" });
  assert.equal(unknown.status, 500); assert.doesNotMatch(unknown.message, /SECRET|SQL|password/);
});
test("users.read is separately required for protected directory reads", async () => {
  const f = fixture();
  await assert.rejects(() => readRoleManagement(f.client, { userId: user, memberId: member, organizationId: org, capabilities: ["users.manage"] }),
    (error: Error & { status?: number }) => error.status === 403);
  assert.equal(f.calls.length, 0);
});
test("member response parsing rejects malformed owner flags and handles unassigned members", () => {
  const row = { member_id: member, display_name: "Unassigned", member_status: "active", role_ids: [], role_names: [], is_owner: false };
  assert.equal(parseMembers([row])[0]?.isOwner, false);
  assert.throws(() => parseMembers([{ ...row, is_owner: null }]));
});
