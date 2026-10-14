import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { defaultRequestDependencies } from "../../apps/web/server/commands/request-context.ts";
import { createTaxVersionCommand, archiveTaxVersionCommand } from "../../apps/web/server/taxes/service.ts";
import { validateTaxVersion, validateArchiveTax, taxDatabaseError } from "../../apps/web/server/taxes/contracts.ts";

const organizationId = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const userId = parseUuid("11111111-1111-4111-8111-111111111111");
const memberId = parseUuid("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
const taxCodeId = parseUuid("aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa");
const accountId = parseUuid("aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa");

const taxVersion = {
  code: " vat_10 ", label: "Illustrative tax", rate_percent: "10.125000", tax_kind: "standard",
  output_account_id: accountId, input_account_id: accountId, recoverability: "full",
  effective_from: "2026-01-01", effective_to: null, expected_latest_row_version: 0,
  reason: "Company approved this illustrative configuration"
};

function fixture(capabilities: readonly string[] = ["tax.manage"]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return name === "archive_tax_code_version"
      ? { data: 2, error: null }
      : { data: [{ tax_code_id: taxCodeId, version_no: 1, row_version: 1 }], error: null };
  } } as unknown as Pick<SupabaseClient, "rpc">;
  const dependencies = { ...defaultRequestDependencies,
    identityVerifier: { verifyIdentity: async () => ({ userId }) },
    membershipResolver: { resolveActiveMembership: async () => ({ memberId, organizationId, capabilities }) }
  };
  return { calls, client, dependencies };
}

test("tax version request is strict, canonical and preserves decimal rate strings", () => {
  assert.deepEqual(validateTaxVersion(taxVersion), {
    code: "VAT_10", label: "Illustrative tax", ratePercent: "10.125000", taxKind: "standard",
    outputAccountId: accountId, inputAccountId: accountId, recoverability: "full",
    effectiveFrom: "2026-01-01", effectiveTo: null, expectedLatestRowVersion: 0,
    reason: "Company approved this illustrative configuration"
  });
  for (const invalid of [
    { ...taxVersion, rate_percent: 10.125 },
    { ...taxVersion, rate_percent: "100.000001" },
    { ...taxVersion, effective_from: "2026-02-30" },
    { ...taxVersion, tax_kind: "reduced" },
    { ...taxVersion, output_account_id: "not-a-uuid" },
    { ...taxVersion, actor_id: userId }
  ]) assert.throws(() => validateTaxVersion(invalid));
});

test("archive requires a positive version and a reason", () => {
  assert.deepEqual(validateArchiveTax({ tax_code_id: taxCodeId, expected_row_version: 2, reason: "Company retired this version" }), {
    taxCodeId, expectedRowVersion: 2, reason: "Company retired this version"
  });
  assert.throws(() => validateArchiveTax({ tax_code_id: taxCodeId, expected_row_version: 0, reason: "Retired" }));
});

test("tax version command scopes its RPC to the verified company and keeps exact rate text", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({
    definition: createTaxVersionCommand(f.client), organizationId, rawInput: taxVersion,
    headers: new Headers({ "x-request-id": "req_tax_unit" }), dependencies: f.dependencies
  });
  assert.equal(result.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.name, "create_tax_code_version");
  assert.equal(f.calls[0]!.args.p_organization_id, organizationId);
  assert.equal(f.calls[0]!.args.p_request_id, "req_tax_unit");
  assert.equal(f.calls[0]!.args.p_rate_percent, "10.125000");
  assert.equal(f.calls[0]!.args.p_expected_latest_row_version, 0);
  assert.ok("data" in result.body && result.body.data.taxCodeId === taxCodeId);
});

test("unprivileged tax write stops before RPC and stale database versions map to conflict", async () => {
  const f = fixture(["tax.read"]);
  const result = await executeOrganizationCommand({
    definition: createTaxVersionCommand(f.client), organizationId, rawInput: taxVersion,
    headers: new Headers(), dependencies: f.dependencies
  });
  assert.equal(result.status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(taxDatabaseError({ code: "40001" }).code, "STALE_VERSION");
  assert.equal(taxDatabaseError({ code: "42501" }).status, 403);
});

test("archive command sends the expected row version to the scoped database routine", async () => {
  const f = fixture();
  const result = await executeOrganizationCommand({
    definition: archiveTaxVersionCommand(f.client), organizationId,
    rawInput: { tax_code_id: taxCodeId, expected_row_version: 1, reason: "Company retired this version" },
    headers: new Headers(), dependencies: f.dependencies
  });
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls[0], { name: "archive_tax_code_version", args: {
    p_organization_id: organizationId, p_tax_code_id: taxCodeId, p_expected_row_version: 1,
    p_request_id: expectRequestId(f.calls[0]!.args.p_request_id), p_reason: "Company retired this version"
  } });
});

function expectRequestId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a request ID string.");
  assert.match(value, /^req_/);
  return value;
}
