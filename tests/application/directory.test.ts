import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId } from "@ams/contracts";
import { readDocumentDirectory } from "../../apps/web/server/documents/directory.ts";
const org = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), id = "11111111-1111-4111-8111-111111111111";
const row = { id, organization_id: org, document_type: "invoice", state: "posted", document_number: "INV-১", accounting_date: "2026-01-01", total_amount: "9007199254740993.17" };
function client(data: unknown) { return { rpc: async (name: string, args: Record<string, unknown>) => {
  assert.equal(name, "read_document_directory"); assert.equal(args.p_organization_id, org); return { data, error: null };
} } as unknown as Pick<SupabaseClient, "rpc">; }
test("scoped read returns exact monetary strings and Unicode without broad payloads", async () => {
  const result = await readDocumentDirectory(client([{ ...row, party_snapshot: "must not escape" }]), org);
  assert.equal(result[0]!.totalAmount, row.total_amount); assert.equal(result[0]!.documentNumber, "INV-১");
  assert.ok(!JSON.stringify(result).includes("must not escape"));
});
test("directory rejects foreign scope, invalid shape, amount, cursor and unbounded page size", async () => {
  for (const data of [null, {}, [null], [{ ...row, organization_id: id }], [{ ...row, total_amount: 1 }], [{ ...row, total_amount: "1e20" }]])
    await assert.rejects(() => readDocumentDirectory(client(data), org));
  for (const limit of [0, 101, NaN, Infinity, 1.5]) await assert.rejects(() => readDocumentDirectory(client([]), org, limit));
  await assert.rejects(() => readDocumentDirectory(client([]), org, 1, "forged"));
});
