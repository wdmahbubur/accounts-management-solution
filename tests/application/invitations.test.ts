import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { invitationInput, recipientInput, invitationToken } from "../../apps/web/server/invitations/contracts.ts";
import { createInvitationSecret, decryptInvitationDelivery, hashInvitationToken } from "../../apps/web/server/invitations/tokens.ts";
import { invitationCommand, invitationDatabaseError, respondToInvitation } from "../../apps/web/server/invitations/service.ts";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { defaultRequestDependencies } from "../../apps/web/server/commands/request-context.ts";
const org = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const user = parseUuid("11111111-1111-4111-8111-111111111111");
const member = parseUuid("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const id = parseUuid("aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa");
const key = "a1".repeat(32); // Synthetic key: no connection to any deployment.
const secrets = (o: string, i: string) => createInvitationSecret(o, i, key);
test("invitation secrets are independent 256-bit URL-safe tokens with authenticated encrypted outbox envelopes", () => {
  const seen = new Set();
  for (let n = 0; n < 100; n++) {
    const secret = secrets(org, id); const token = secret.invitationPath.split("/").at(-1)!;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/); assert.match(secret.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(hashInvitationToken(token), secret.tokenHash);
    assert.equal(decryptInvitationDelivery(org, id, secret.tokenHash, secret.delivery, key), token);
    assert.equal(secret.delivery.iv.length, 16); assert.equal(secret.delivery.tag.length, 22); assert.equal(secret.delivery.ciphertext.length, 58);
    assert.ok(!JSON.stringify(secret.delivery).includes(token)); seen.add(token);
  }
  assert.equal(seen.size, 100);
});
test("delivery encryption rejects changed company, invitation, hash, key and envelope", () => {
  const secret = secrets(org, id);
  for (const [o, i, h, k] of [[user, id, secret.tokenHash, key], [org, user, secret.tokenHash, key],
    [org, id, "b".repeat(64), key], [org, id, secret.tokenHash, "b2".repeat(32)]]) {
    assert.throws(() => decryptInvitationDelivery(o!, i!, h!, secret.delivery, k));
  }
  assert.throws(() => decryptInvitationDelivery(org, id, secret.tokenHash, { ...secret.delivery, tag: "c".repeat(22) }, key));
  for (const invalid of ["", "public", "a".repeat(63), "g".repeat(64)]) assert.throws(() => createInvitationSecret(org, id, invalid));
});
test("invitation input is strict, normalized and never trusts caller authority or stored hashes as bearer tokens", () => {
  assert.deepEqual(invitationInput("create", { email: " USER@Example.invalid ", role_id: id }), { email: "user@example.invalid", roleId: id });
  for (const extra of [{ actor_id: user }, { token_hash: "a".repeat(64) }, { expires_at: "2099" }, { organization_id: org }])
    assert.throws(() => invitationInput("create", { email: "a@example.invalid", role_id: id, ...extra }));
  for (const email of ["", "a@b", "x\n@example.invalid", "a".repeat(255)+"@x.y"]) assert.throws(() => invitationInput("create", { email, role_id: id }));
  assert.throws(() => invitationInput("resend", { invitation_id: id, role_id: id }));
  for (const raw of [null, "", "x".repeat(42), "a".repeat(64), "../".repeat(15)]) assert.throws(() => invitationToken(raw));
  assert.throws(() => recipientInput({ token: "x".repeat(43), decision: "accept", email: "forged@example.invalid" }));
  assert.throws(() => recipientInput({ token: "x".repeat(43), decision: "owner" }));
});
function fixture(capabilities = ["users.manage"]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: id, error: null }; } } as unknown as Pick<SupabaseClient, "rpc">;
  return { calls, client, dependencies: { ...defaultRequestDependencies,
    identityVerifier: { verifyIdentity: async () => ({ userId: user }) },
    membershipResolver: { resolveActiveMembership: async () => ({ memberId: member, organizationId: org, capabilities }) } } };
}
test("invitation command uses the verified tenant and request correlation; plaintext is never passed to storage RPC", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({ definition: invitationCommand("create", f.client, secrets), organizationId: org,
    rawInput: { email: "new@example.invalid", role_id: id }, headers: new Headers({ "x-request-id": "req_invite_unit" }), dependencies: f.dependencies });
  assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.name, "issue_company_invitation");
  const args = f.calls[0]!.args; assert.equal(args.p_organization_id, org); assert.equal(args.p_request_id, "req_invite_unit");
  assert.equal(args.p_role_id, id); assert.equal(args.p_email, "new@example.invalid");
  assert.ok("data" in result.body && result.body.data.invitationPath);
  if ("data" in result.body) {
    const token = result.body.data.invitationPath!.split("/").at(-1)!;
    assert.equal(args.p_token_hash, hashInvitationToken(token)); assert.ok(!JSON.stringify(args).includes(token));
  }
});
test("unprivileged, removed and forged-authority invitations stop before SQL mutation", async () => {
  const f = fixture(["users.read"]);
  const request = { definition: invitationCommand("create", f.client, secrets), organizationId: org,
    rawInput: { email: "new@example.invalid", role_id: id }, headers: new Headers(), dependencies: f.dependencies };
  assert.equal((await executeOrganizationCommand(request)).status, 403);
  assert.equal((await executeOrganizationCommand({ ...request, dependencies: { ...f.dependencies, membershipResolver: { resolveActiveMembership: async () => null } } })).status, 404);
  const allowed = fixture();
  assert.equal((await executeOrganizationCommand({ ...request, definition: invitationCommand("create", allowed.client, secrets),
    dependencies: allowed.dependencies, rawInput: { ...request.rawInput, actor_id: user } })).status, 422);
  assert.equal(f.calls.length + allowed.calls.length, 0);
});
test("revoke needs no delivery key and cannot echo an old invitation link", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({ definition: invitationCommand("revoke", f.client, () => { throw new Error("No secret should be minted."); }),
    organizationId: org, rawInput: { invitation_id: id }, headers: new Headers(), dependencies: f.dependencies });
  assert.equal(result.status, 200); assert.equal(f.calls[0]!.name, "revoke_company_invitation");
  assert.ok("data" in result.body && !("invitationPath" in result.body.data));
});
test("recipient response authenticates with getUser and does not send requested user, company or role authority", async () => {
  let calls = 0;
  const client = { auth: { getUser: async () => ({ data: { user: { id: user } }, error: null }) }, rpc: async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, "respond_company_invitation"); assert.deepEqual(Object.keys(args).sort(), ["p_decision", "p_request_id", "p_token"]);
    return { data: [{ organization_id: org, member_id: member, invitation_status: "accepted" }], error: null };
  } } as unknown as Pick<SupabaseClient, "rpc" | "auth">;
  assert.equal((await respondToInvitation(client, { token: "x".repeat(43), decision: "accept" })).status, "accepted");
  assert.equal(calls, 1);
  const anonymous = { ...client, auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as unknown as typeof client;
  await assert.rejects(() => respondToInvitation(anonymous, { token: "x".repeat(43), decision: "accept" }), (e: Error & { status?: number }) => e.status === 401);
  assert.equal(calls, 1);
});
test("invitation DB errors are stable and do not disclose token, SQL or encryption configuration", () => {
  for (const [code, status] of [["28000",401],["42501",403],["P0002",404],["22023",422],["23505",409],["P0429",429],["XX000",500]] as const) {
    const error = invitationDatabaseError({ code, message: "SECRET SQL token_hash INVITATION_DELIVERY_KEY" });
    assert.equal(error.status, status); assert.doesNotMatch(error.message, /SECRET|SQL|token_hash|INVITATION_DELIVERY_KEY/);
  }
});
