import assert from "node:assert/strict";
import test from "node:test";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { completeCompanySetupCommand, parseCompleteSetupReceipt, setupDatabaseError, validateCompleteSetup } from "../../apps/web/server/onboarding/setup.ts";
import { openingDraftPayload, saveOpeningDraftCommand, validateOpeningDraft } from "../../apps/web/server/onboarding/opening-draft.ts";
import { parsePendingOpeningSave, recoverOpeningFields } from "../../apps/web/app/o/[organizationId]/settings/opening-balances/opening-recovery.ts";
import type { OrganizationCommandContext } from "../../apps/web/server/commands/types.ts";
import { workspaceNavigation } from "../../apps/web/components/shell/navigation.ts";
import type { RequestClient } from "../../apps/web/server/request-client.ts";

const organization = "09a79fda-decf-4da4-8f96-e92d4404fb41";
const document = "09a79fda-decf-4da4-8f96-e92d4404fb42";
const party = "09a79fda-decf-4da4-8f96-e92d4404fb43";
const zero = { opening_mode: "zero_opening", zero_opening_confirmed: true, opening_document_id: null, expected_document_version: null };
const imported = { opening_mode: "import_opening", zero_opening_confirmed: false, opening_document_id: document, expected_document_version: 2 };
const receipt = { organization_id: organization, status: "active", opening_mode: "zero_opening", completed_at: "2026-10-08T12:00:00Z", opening_document_id: null, opening_document_number: null };

test("setup requires an explicit zero position and rejects ambiguous or malformed import choices", () => {
  assert.equal(validateCompleteSetup(zero).openingMode, "zero_opening");
  assert.equal(validateCompleteSetup(imported).expectedDocumentVersion, 2);
  for (const invalid of [{ ...zero, zero_opening_confirmed: false }, { ...zero, opening_document_id: document }, { ...zero, expected_document_version: 1 },
    { ...zero, status: "active" }, { ...imported, zero_opening_confirmed: true }, { ...imported, expected_document_version: 0 },
    { ...imported, expected_document_version: 1.1 }, { ...imported, opening_document_id: null }]) assert.throws(() => validateCompleteSetup(invalid));
});

test("completion receipt cannot report imported books without a posted opening reference", () => {
  assert.equal(parseCompleteSetupReceipt(receipt).openingDocumentId, null);
  assert.throws(() => parseCompleteSetupReceipt({ ...receipt, opening_mode: "import_opening" }));
  assert.throws(() => parseCompleteSetupReceipt({ ...receipt, opening_document_id: document }));
  const posted = parseCompleteSetupReceipt({ ...receipt, opening_mode: "import_opening", opening_document_id: document, opening_document_number: "OP-00001" });
  assert.equal(posted.openingDocumentNumber, "OP-00001");
});

function context(capabilities: string[]): OrganizationCommandContext {
  return { actor: { organizationId: parseOrganizationId(organization), memberId: parseUuid(party), userId: parseUuid(document), capabilities },
    idempotencyKey: "09a79fda-decf-4da4-8f96-e92d4404fb45" as OrganizationCommandContext["idempotencyKey"],
    requestId: "setup-test-request" as OrganizationCommandContext["requestId"], requestHash: "a".repeat(64) };
}

test("import activation requires journal.post before calling the database", async () => {
  let calls = 0;
  const client = { rpc: async () => { calls += 1; return { data: receipt, error: null }; } } as Pick<RequestClient,"rpc">;
  await assert.rejects(() => completeCompanySetupCommand(client).execute(context(["company.update"]), validateCompleteSetup(imported)), { code: "FORBIDDEN" });
  assert.equal(calls, 0);
});

test("setup command forwards the exact choice, version and stable retry envelope", async () => {
  let invocation: Record<string,unknown> | undefined;
  const client = { rpc: async (name: string, args: Record<string,unknown>) => {
    assert.equal(name, "complete_company_setup"); invocation = args; return { data: receipt, error: null };
  } } as Pick<RequestClient,"rpc">;
  const request = context(["company.update"]);
  await completeCompanySetupCommand(client).execute(request, validateCompleteSetup(zero));
  assert.equal(invocation?.p_idempotency_key, request.idempotencyKey);
  assert.equal(invocation?.p_request_hash, request.requestHash);
  assert.equal(invocation?.p_zero_opening_confirmed, true);
  assert.equal(invocation?.p_expected_document_version, null);
});

test("setup errors preserve live permission, stale approval and transactional retry distinctions", () => {
  assert.equal((setupDatabaseError({ code: "42501" }) as { code?:string }).code, "FORBIDDEN");
  assert.equal((setupDatabaseError({ code: "40001", message: "approved version changed" }) as { code?:string }).code, "STALE_VERSION");
  assert.equal(setupDatabaseError({ code: "40001", message: "could not serialize access" }).name, "RetryableTransactionError");
  assert.equal(setupDatabaseError({ code: "40P01" }).name, "RetryableTransactionError");
  assert.equal((setupDatabaseError({ code: "P0001" }) as { code?:string }).code, "APPROVAL_REQUIRED");
});

function opening() {
  const journal_rows = [
    { account_id: organization, party_id: party, cost_center_id: null, debit: "100.00", credit: "0.00", description: "Prior receivable", cash_flow_class: null, open_item_reference: "OLD-100", open_item_due_date: "2026-04-15" },
    { account_id: document, party_id: null, cost_center_id: null, debit: "0.00", credit: "100.00", description: "Prior capital", cash_flow_class: null, open_item_reference: null, open_item_due_date: null }
  ];
  return { document_id: null, expected_version: null, evidence_reference: "Prior ledger export", prior_trial_balance: journal_rows.map(({account_id,debit,credit}) => ({account_id,debit,credit})), ytd_summary: [],
    draft: { document_type: "opening_balance", party_id: null, issue_date: "2026-03-31", accounting_date: "2026-03-31", due_date: null, external_reference: "Prior ledger export", description: "Opening position", currency: "BDT", rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null, trade: null, movement: null, transfer: null, lines: [], journal_rows, allocation_plan: [] } };
}

test("atomic opening request preserves party detail, original references, due dates and exact amounts", () => {
  const raw = opening(), parsed = validateOpeningDraft(raw);
  assert.deepEqual(openingDraftPayload(parsed.draft).journal_rows, raw.draft.journal_rows);
  assert.deepEqual(parsed.priorTrialBalance, raw.prior_trial_balance);
  assert.equal(parsed.evidenceReference, "Prior ledger export");
});

test("opening edit requires a current version and canonical money without coercion", () => {
  const raw = opening();
  assert.throws(() => validateOpeningDraft({ ...raw, document_id: document }));
  assert.equal(validateOpeningDraft({ ...raw, document_id: document, expected_version: 3 }).expectedVersion, 3);
  assert.throws(() => validateOpeningDraft({ ...raw, evidence_reference: " " }));
  assert.throws(() => validateOpeningDraft({ ...raw, prior_trial_balance: [{ account_id: organization, debit: 100, credit: "0.00" }] }));
  assert.throws(() => validateOpeningDraft({ ...raw, prior_trial_balance: [] }));
});

test("opening recovery retains the byte-identical body and key across a lost response", () => {
  const pending = { key: document, body: JSON.stringify(opening()) };
  assert.deepEqual(parsePendingOpeningSave(JSON.stringify(pending)), pending);
  assert.equal(parsePendingOpeningSave("invalid JSON"), null);
  assert.equal(parsePendingOpeningSave(JSON.stringify({ ...pending, key: "short" })), null);
  assert.equal(parsePendingOpeningSave(JSON.stringify({ ...pending, body: JSON.stringify({ draft: { document_type: "invoice" } }) })), null);
});


test("recovering a definitive save rejection after reload restores all editable opening values", () => {
  const request = parsePendingOpeningSave(JSON.stringify({ key: document, body: JSON.stringify(opening()) }));
  assert.ok(request);
  const recovered = recoverOpeningFields(request, [{id:organization,control_kind:"ar"},{id:document,control_kind:null}]);
  assert.deepEqual(recovered.balances[document], {debit:"0.00",credit:"100.00"});
  assert.deepEqual(recovered.details[0], {id:"0",account_id:organization,party_id:party,reference:"OLD-100",due_date:"2026-04-15",debit:"100.00",credit:"0.00"});
  assert.equal(recovered.evidence, "Prior ledger export");
  assert.throws(() => recoverOpeningFields(request, []), /retained/);
});

test("dedicated opening preparation requires permission to read its cutover evidence", async () => {
  let called = false;
  const client = { rpc: async () => { called=true;return {data:null,error:null}; } } as Pick<RequestClient,"rpc">;
  await assert.rejects(() => saveOpeningDraftCommand(client).execute(context(["journal.write","documents.read"]), validateOpeningDraft(opening())), {code:"FORBIDDEN"});
  assert.equal(called,false);
});


test("opening navigation requires the same preparation and evidence permissions as its route", () => {
  const openingLink = (capabilities:string[]) => workspaceNavigation(organization,capabilities).flatMap(group=>group.items).some(item=>item.href.endsWith("/settings/opening-balances"));
  assert.equal(openingLink(["journal.write"]),false);
  assert.equal(openingLink(["journal.write","documents.read"]),false);
  assert.equal(openingLink(["journal.write","documents.read","accounting.read"]),true);
});
