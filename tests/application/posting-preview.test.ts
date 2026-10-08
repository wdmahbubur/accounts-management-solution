import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { canEditFinancialDocument, previewApprovalDocument, previewFinancialDocument } from "../../apps/web/server/documents/service.ts";
import { cashPreviewTypes, parseCashPreviewDatabaseResult, parsePostingPreviewResult } from "../../apps/web/lib/posting-preview.ts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";

const org = parseOrganizationId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const documentId = parseUuid("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
const requestId = parseUuid("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
const accountA = parseUuid("11111111-1111-4111-8111-111111111111");
const accountB = parseUuid("22222222-2222-4222-8222-222222222222");
const accountC = parseUuid("33333333-3333-4333-8333-333333333333");
const actor = (capabilities: string[]): ActorContext => ({ organizationId: org, userId: accountA, memberId: accountB, capabilities });
const source = (type: string) => ({ id: documentId, document_type: type, version: 3, state: "draft", currency: "BDT",
  movement: { amount: "1250.00" }, transfer: { amount: "1250.00", fee_amount: "25.00" }, lines: [], journal_rows: [] });
function databasePreview(type: string) {
  const transfer = type === "transfer";
  const total = transfer ? "1275.00" : "1250.00";
  return { document_id: documentId, document_version: 3, document_type: type, currency: "BDT", debit: total, credit: total, balanced: true,
    lines: [
      { line_no: 1, account_id: accountA, account_code: "1010", account_name: "Cash account", party_name: null, description: "Cash movement", debit: "1250.00", credit: "0.00" },
      ...(transfer ? [{ line_no: 2, account_id: accountC, account_code: "6400", account_name: "Bank charges", party_name: null, description: "Transfer fee", debit: "25.00", credit: "0.00" }] : []),
      { line_no: transfer ? 3 : 2, account_id: accountB, account_code: "1100", account_name: transfer ? "Source bank" : "Control account", party_name: null, description: "Cash movement", debit: "0.00", credit: total }
    ], allocations: [], allocated_amount: "0.00", unallocated_amount: ["receipt", "vendor_payment"].includes(type) ? total : null };
}

for (const type of cashPreviewTypes) {
  test(`${type} draft preview delegates to the authoritative SQL plan instead of empty journal rows`, async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client = { async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return { data: name === "read_financial_document" ? source(type) : databasePreview(type), error: null };
    } };
    const result = await previewFinancialDocument(client, actor(["sales.write", "purchases.write", "banking.write"]), documentId, 3);
    assert.equal(result.preview.kind, "cash");
    assert.deepEqual(calls.map(call => call.name), ["read_financial_document", "preview_cash_document_posting"]);
    assert.deepEqual(calls[1]?.args, { p_organization_id: org, p_document_id: documentId, p_expected_version: 3 });
    assert.equal("debit" in result.preview && result.preview.debit, type === "transfer" ? "1275.00" : "1250.00");
  });
}

test("approval preview uses the submitted request ID and works without source-write capability", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    return { data: name === "read_approval_review"
      ? { document_id: documentId, document_version: 3, state: "approved", stale: false, document: { ...source("receipt"), state: "approved" } }
      : databasePreview("receipt"), error: null };
  } };
  const result = await previewApprovalDocument(client, actor(["approvals.read", "sales.read"]), requestId, 3);
  assert.equal(result.preview.kind, "cash");
  assert.deepEqual(calls[1], { name: "preview_approval_cash_posting", args: { p_organization_id: org, p_approval_request_id: requestId, p_expected_version: 3 } });
});

test("changed approval evidence fails before requesting a cash preview", async () => {
  for (const evidence of [{ stale: true }, { document_version: 4 }, { state: "rejected" }]) {
    const calls: string[] = [];
    const client = { async rpc(name: string) {
      calls.push(name);
      return { data: { document_id: documentId, document_version: 3, state: "approved", stale: false,
        document: { ...source("receipt"), state: "approved" }, ...evidence }, error: null };
    } };
    await assert.rejects(previewApprovalDocument(client, actor(["approvals.read"]), requestId, 3), { code: "APPROVAL_STALE" });
    assert.deepEqual(calls, ["read_approval_review"]);
  }
});

test("cash preview database errors retain useful conflict and permission responses", async () => {
  for (const [sqlCode, code] of [["23P01", "ALLOCATION_EXCEEDED"], ["40001", "STALE_VERSION"], ["42501", "FORBIDDEN"], ["23514", "VALIDATION_FAILED"]]) {
    const client = { async rpc(name: string) { return name === "read_financial_document" ? { data: source("receipt"), error: null }
      : { data: null, error: { code: sqlCode, message: "synthetic failure" } }; } };
    await assert.rejects(previewFinancialDocument(client, actor(["sales.write"]), documentId, 3), { code });
  }
});

test("read-only draft readers are not treated as editors and cannot invoke draft preview", async () => {
  const reader = actor(["sales.read", "documents.read"]);
  assert.equal(canEditFinancialDocument(reader, "receipt"), false);
  assert.equal(canEditFinancialDocument(actor(["sales.write"]), "receipt"), true);
  const client = { async rpc() { return { data: source("receipt"), error: null }; } };
  await assert.rejects(previewFinancialDocument(client, reader, documentId, 3), { code: "FORBIDDEN" });
});

test("typed cash response rejects zero previews, stale identities and numeric money", () => {
  const valid = databasePreview("transfer");
  assert.equal(parseCashPreviewDatabaseResult(valid, documentId, 3).preview.kind, "cash");
  for (const invalid of [{ ...valid, debit: "0.00", credit: "0.00" }, { ...valid, document_id: accountA },
    { ...valid, document_version: 4 }, { ...valid, debit: 1275 }, { ...valid, lines: [] }]) {
    assert.throws(() => parseCashPreviewDatabaseResult(invalid, documentId, 3));
  }
});

test("trade and journal previews retain exact existing calculations with typed readable rows", async () => {
  const trade = { ...source("invoice"), rounding_adjustment: "0.00", lines: [{ id: accountA, description: "Service",
    quantity: "1.000000", unit_price: "123.450000", discount_amount: "0.00", tax_rate_snapshot: "0.000000", tax_mode: "exclusive" }] };
  const tradeClient = { async rpc(name: string) { return { data: name === "read_financial_document" ? trade : [], error: null }; } };
  const calculated = parsePostingPreviewResult(await previewFinancialDocument(tradeClient, actor(["sales.write"]), documentId, 3));
  assert.equal(calculated.preview.kind, "trade");
  assert.equal("total" in calculated.preview && calculated.preview.total, "123.45");
  const journal = { ...source("manual_journal"), journal_rows: [
    { account_id: accountA, description: "Debit", debit: "9007199254740993.17", credit: "0.00" },
    { account_id: accountB, description: "Credit", debit: "0.00", credit: "9007199254740993.17" }
  ] };
  const journalClient = { async rpc() { return { data: journal, error: null }; } };
  const result = parsePostingPreviewResult(await previewFinancialDocument(journalClient, actor(["journal.write"]), documentId, 3));
  assert.equal("debit" in result.preview && result.preview.debit, "9007199254740993.17");
  assert.equal("balanced" in result.preview && result.preview.balanced, true);
});

test("an empty manual journal is incomplete, and unsupported source types never become zero balanced previews", async () => {
  const client = { async rpc() { return { data: source("manual_journal"), error: null }; } };
  const result = await previewFinancialDocument(client, actor(["journal.write"]), documentId, 3);
  assert.equal("balanced" in result.preview && result.preview.balanced, false);
  const unsupported = { async rpc() { return { data: source("write_off"), error: null }; } };
  await assert.rejects(previewFinancialDocument(unsupported, actor(["journal.write"]), documentId, 3), { code: "VALIDATION_FAILED" });
});
