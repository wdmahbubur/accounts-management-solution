import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { ActorContext } from "../../apps/web/server/auth/types.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";
import { readCreditNoteOptions } from "../../apps/web/server/documents/credit-notes.ts";
import { documentDatabaseError } from "../../apps/web/server/documents/contracts.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";

const org = "c5198af6-9e5e-4352-9420-e98c62133100";
const sourceId = "c5198af6-9e5e-4352-9420-e98c62133101";
const partyId = "c5198af6-9e5e-4352-9420-e98c62133102";
const lineId = "c5198af6-9e5e-4352-9420-e98c62133103";
const accountId = "c5198af6-9e5e-4352-9420-e98c62133104";
const actor: ActorContext = { organizationId: parseOrganizationId(org), userId: parseUuid(sourceId), memberId: parseUuid(partyId), capabilities: ["sales.read"] };
const filters = { documentType: "customer_credit" as const, accountingDate: "2026-10-09", partyId, originalDocumentId: sourceId };
function fixture() {
  const summary = { id: sourceId, document_number: "INV-QA-001", party_id: partyId, party_name: "Issued customer", issue_date: "2026-09-01",
    accounting_date: "2026-09-01", supplier_reference: null, total_amount: "1250.37", eligible: true, blocked_reason: null };
  const line = { id: lineId, line_no: 1, description: "Original service", item_id: null, account_id: accountId, account_code: "4000", account_name: "Original revenue",
    cost_center_id: null, cost_center_code: null, cost_center_name: null, quantity: "2.500000", unit_price: "500.148000", discount_amount: "0.00",
    net_amount: "1250.37", tax_amount: "0.00", gross_amount: "1250.37", tax_code_id: null, tax_label_snapshot: "Historic exempt basis", tax_rate_snapshot: "0.000000",
    tax_mode: "inclusive", tax_recoverability_snapshot: "none", tax_account_id: null, remaining_quantity: "1.000001", remaining_net_amount: "500.14",
    remaining_tax_amount: "0.00", remaining_gross_amount: "500.14", eligible: true, blocked_reason: null };
  return { organization_id: org, document_type: "customer_credit", accounting_date: filters.accountingDate, sources: [summary], has_more: false,
    selected_source: { ...summary, party_snapshot: { display_name: "Issued customer", billing_address: { line1: "Original road" }, tax_identifiers: { tin: "OLD" } },
      recognition_mode: "earned_or_incurred", remaining_total_amount: "500.14", lines: [line] } };
}
function client(data: unknown, calls: { name: string; args: Record<string, unknown> }[] = [], error: { code: string } | null = null): Pick<RequestClient, "rpc"> {
  return { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data, error }; } } as Pick<RequestClient, "rpc">;
}

test("module-only readers receive immutable original snapshots, exact source pricing and dated capacity without write or ledger options", async () => {
  const raw = fixture(), before = structuredClone(raw), calls: { name: string; args: Record<string, unknown> }[] = [];
  const result = await readCreditNoteOptions(client(raw, calls), actor, filters);
  assert.deepEqual(raw, before);
  assert.equal(result.selectedSource?.partyName, "Issued customer");
  assert.deepEqual(result.selectedSource?.partySnapshot, raw.selected_source.party_snapshot);
  assert.equal(result.selectedSource?.lines[0].unitPrice, "500.148000");
  assert.equal(result.selectedSource?.lines[0].remainingQuantity, "1.000001");
  assert.equal(result.selectedSource?.lines[0].taxMode, "inclusive");
  assert.equal(result.selectedSource?.lines[0].taxLabelSnapshot, "Historic exempt basis");
  assert.equal(result.selectedSource?.remainingTotalAmount, "500.14");
  assert.deepEqual(calls, [{ name: "read_credit_note_options", args: { p_organization_id: org, p_document_type: "customer_credit",
    p_accounting_date: "2026-10-09", p_party_id: partyId, p_original_document_id: sourceId, p_search: null } }]);
});

test("supplier credit reads require purchases.read and return the supplier original reference", async () => {
  const raw = fixture();
  const data = { ...raw, document_type: "vendor_credit", sources: raw.sources.map(source => ({ ...source, supplier_reference: "SUPPLIER-REF" })),
    selected_source: { ...raw.selected_source, supplier_reference: "SUPPLIER-REF" } };
  const result = await readCreditNoteOptions(client(data), { ...actor, capabilities: ["purchases.read"] }, { ...filters, documentType: "vendor_credit" });
  assert.equal(result.selectedSource?.supplierReference, "SUPPLIER-REF");
  await assert.rejects(() => readCreditNoteOptions(client(data), actor, { ...filters, documentType: "vendor_credit" }), { code: "FORBIDDEN" });
});

test("missing module reads are denied before any RPC even when generic document or write permission exists", async () => {
  for (const capabilities of [[], ["documents.read"], ["sales.write"], ["purchases.read"]]) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    await assert.rejects(() => readCreditNoteOptions(client(fixture(), calls), { ...actor, capabilities }, filters), { code: "FORBIDDEN" });
    assert.equal(calls.length, 0);
  }
});

test("invalid dates, searches and identifiers never reach the source RPC", async () => {
  for (const changes of [{ accountingDate: "2026-02-30" }, { accountingDate: "not-a-date" }, { search: "x".repeat(101) }, { partyId: "not-a-uuid" }, { originalDocumentId: "not-a-uuid" }]) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    await assert.rejects(() => readCreditNoteOptions(client(fixture(), calls), actor, { ...filters, ...changes }));
    assert.equal(calls.length, 0);
  }
});

test("responses from another organization, date, source or party are rejected", async () => {
  const raw = fixture();
  for (const data of [{ ...raw, organization_id: sourceId }, { ...raw, accounting_date: "2026-10-08" },
    { ...raw, selected_source: { ...raw.selected_source, id: lineId } },
    { ...raw, selected_source: { ...raw.selected_source, party_id: lineId } },
    { ...raw, sources: [{ ...raw.sources[0], party_id: lineId }] }, { ...raw, selected_source: null }]) {
    await assert.rejects(() => readCreditNoteOptions(client(data), actor, filters));
  }
});

test("malformed numbers, duplicate lines and oversized option lists fail closed", async () => {
  const raw = fixture();
  for (const data of [{ ...raw, sources: Array.from({ length: 101 }, () => raw.sources[0]) },
    { ...raw, selected_source: { ...raw.selected_source, lines: [raw.selected_source.lines[0], raw.selected_source.lines[0]] } },
    { ...raw, selected_source: { ...raw.selected_source, lines: [{ ...raw.selected_source.lines[0], unit_price: 500.148 }] } },
    { ...raw, selected_source: { ...raw.selected_source, remaining_total_amount: "NaN" } },
    { ...raw, selected_source: { ...raw.selected_source, lines: [{ ...raw.selected_source.lines[0], remaining_quantity: "-1.000000" }] } }]) {
    await assert.rejects(() => readCreditNoteOptions(client(data), actor, filters));
  }
});

test("empty lookup and explicit unavailable sources preserve a clear scoped read result", async () => {
  const raw = fixture();
  const empty = await readCreditNoteOptions(client({ ...raw, sources: [], selected_source: null }), actor, { ...filters, originalDocumentId: null });
  assert.deepEqual(empty.sources, []); assert.equal(empty.selectedSource, null);
  const blocked = { ...raw, selected_source: { ...raw.selected_source, eligible: false, blocked_reason: "This original document has been reversed." } };
  assert.equal((await readCreditNoteOptions(client(blocked), actor, filters)).selectedSource?.blockedReason, blocked.selected_source.blocked_reason);
  await assert.rejects(() => readCreditNoteOptions(client(null, [], { code: "P0002" }), actor, filters), { code: "NOT_FOUND" });
});

test("authoritative credit guard errors reach the matching form fields without raw SQL text", () => {
  for (const [message, field] of [["credit lines exceed remaining original quantity or amount", "lines"],
    ["credit total including rounding exceeds remaining original total", "rounding_adjustment"],
    ["credit lines must preserve the selected original accounting and tax snapshots", "lines"],
    ["credit original is reversed, future-dated, or incompatible", "original_document_id"]]) {
    const error = documentDatabaseError({ code: "23514", message });
    assert.ok(error instanceof CommandError);
    assert.equal(error.code, "VALIDATION_FAILED");
    assert.ok(error.fields?.[field]);
  }
});

test("unrecognized database details never become credit form messages", () => {
  const literal = "credit lines exceed remaining original quantity or amount";
  for (const databaseError of [{ code: "23514", message: `${literal}: private SQL detail` }, { code: "23503", message: literal }]) {
    const error = documentDatabaseError(databaseError);
    assert.ok(error instanceof CommandError);
    assert.deepEqual(error.fields, { document: "The draft conflicts with a company, date, account, or source rule." });
  }
});
