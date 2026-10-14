import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { defaultRequestDependencies } from "../../apps/web/server/commands/request-context.ts";
import { createDraftCommand, updateDraftCommand } from "../../apps/web/server/documents/service.ts";
import { validateDraftDocument, validateAllocationPlanInput, documentDatabaseError } from "../../apps/web/server/documents/contracts.ts";

const organizationId = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const userId = parseUuid("11111111-1111-4111-8111-111111111111");
const memberId = parseUuid("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const documentId = parseUuid("aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa");
const accountId = parseUuid("aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa");
const partyId = parseUuid("aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa");
const taxCodeId = parseUuid("aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa");

const invoice = {
  document_type: "invoice", party_id: partyId, issue_date: "2026-09-01", accounting_date: "2026-09-01",
  due_date: "2026-10-01", external_reference: null, description: "A draft service invoice", currency: "BDT",
  rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null,
  trade: { recognition_mode: "earned_or_incurred", performance_confirmed: false }, movement: null, transfer: null,
  lines: [{ id: null, item_id: null, original_line_id: null, description: "Consulting service", quantity: "1.000000",
    unit_price: "10000.000000", discount_amount: "0.00", account_id: accountId, cost_center_id: null,
    tax_code_id: taxCodeId, tax_mode: "exclusive", cash_flow_class: "operating" }],
  journal_rows: [], allocation_plan: []
};

function fixture(capabilities: readonly string[] = ["documents.read", "sales.write"]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: [{ document_id: documentId, document_version: 1, state: "draft", net_amount: "10000.00",
      tax_amount: "1000.00", total_amount: "11000.00", material_digest: "a".repeat(64) }], error: null };
  } } as unknown as Pick<SupabaseClient, "rpc">;
  const dependencies = { ...defaultRequestDependencies,
    identityVerifier: { verifyIdentity: async () => ({ userId }) },
    membershipResolver: { resolveActiveMembership: async () => ({ memberId, organizationId, capabilities }) }
  };
  return { calls, client, dependencies };
}

test("invoice draft input is strict and keeps exact decimal strings", () => {
  const valid = validateDraftDocument(invoice);
  assert.equal(valid.documentType, "invoice");
  assert.equal(valid.lines[0]!.unitPrice, "10000.000000");
  assert.equal(valid.lines[0]!.taxCodeId, taxCodeId);
  for (const invalid of [
    { ...invoice, issue_date: "2026-02-30" },
    { ...invoice, currency: "USD" },
    { ...invoice, actor_id: userId },
    { ...invoice, lines: [{ ...invoice.lines[0], unit_price: 10000 }] },
    { ...invoice, lines: [{ ...invoice.lines[0], tax_mode: "unknown" }] },
    { ...invoice, trade: null }
  ]) assert.throws(() => validateDraftDocument(invalid));
});

test("allocation plans reject duplicate, zero and malformed targets before database execution", () => {
  const valid = validateAllocationPlanInput({ expected_version: 2, allocation_plan: [{ target_open_item_id: documentId, amount: "10.00" }] });
  assert.equal(valid.expectedVersion, 2);
  assert.equal(valid.allocationPlan[0]!.amount, "10.00");
  assert.throws(() => validateAllocationPlanInput({ expected_version: 2, allocation_plan: [
    { target_open_item_id: documentId, amount: "10.00" }, { target_open_item_id: documentId, amount: "1.00" }
  ] }));
  assert.throws(() => validateAllocationPlanInput({ expected_version: 2, allocation_plan: [{ target_open_item_id: documentId, amount: "0.00" }] }));
});

test("draft creation uses verified company, idempotency and a server-only save RPC", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({
    definition: createDraftCommand(f.client), organizationId, rawInput: invoice,
    headers: new Headers({ "x-request-id": "req_document_unit", "idempotency-key": "a1".repeat(32) }),
    dependencies: f.dependencies
  });
  assert.equal(result.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.name, "save_financial_document");
  const args = f.calls[0]!.args;
  assert.equal(args.p_organization_id, organizationId);
  assert.equal(args.p_document_id, null);
  assert.equal(args.p_expected_version, null);
  assert.equal(args.p_request_id, "req_document_unit");
  assert.equal((args.p_payload as Record<string, unknown>).document_type, "invoice");
  assert.equal(((args.p_payload as { lines: { unit_price: string }[] }).lines[0]!).unit_price, "10000.000000");
  assert.ok("data" in result.body && result.body.data.documentVersion === 1);
});

test("a draft update sends expected version and stops on a missing write capability", async () => {
  const f = fixture();
  const payload = { expected_version: 3, draft: invoice };
  const result = await executeOrganizationCommand({
    definition: updateDraftCommand(f.client, documentId), organizationId, rawInput: payload,
    headers: new Headers({ "idempotency-key": "b2".repeat(32) }), dependencies: f.dependencies
  });
  assert.equal(result.status, 200);
  assert.equal(f.calls[0]!.args.p_document_id, documentId);
  assert.equal(f.calls[0]!.args.p_expected_version, 3);

  const denied = fixture(["documents.read"]);
  const deniedResult = await executeOrganizationCommand({
    definition: createDraftCommand(denied.client), organizationId, rawInput: invoice,
    headers: new Headers({ "idempotency-key": "c3".repeat(32) }), dependencies: denied.dependencies
  });
  assert.equal(deniedResult.status, 403);
  assert.equal(denied.calls.length, 0);
  assert.equal(documentDatabaseError({ code: "40001" }).code, "STALE_VERSION");
});
