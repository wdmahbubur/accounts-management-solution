// Sequential fixtures roll back. Concurrency scenarios commit unique synthetic
// organizations so separate connections can race; they retain immutable evidence. Requires explicitly named test URLs, never falls back to a live app URL.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "@neondatabase/serverless";
import "./load-local-env.mjs";
import { normalizeRpcResult, prepareRpcArguments } from "../apps/web/server/rpc-values.ts";
import { parseCompanySetup, parseCompleteSetupReceipt } from "../apps/web/server/onboarding/setup.ts";

const runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL;
const migrationUrl = process.env.TEST_DATABASE_URL;
if (!runtimeUrl || !migrationUrl) throw new Error("Set TEST_DATABASE_RUNTIME_URL and TEST_DATABASE_URL for an isolated test database.");
const runtimeLocation = new URL(runtimeUrl), migrationLocation = new URL(migrationUrl);
if (runtimeLocation.hostname.replace("-pooler", "") !== migrationLocation.hostname.replace("-pooler", "") || runtimeLocation.pathname !== migrationLocation.pathname) {
  throw new Error("Test runtime and migration URLs must identify the same isolated database.");
}
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 3, connectionTimeoutMillis: 30_000 });
const adminPool = new Pool({ connectionString: migrationUrl, max: 1, connectionTimeoutMillis: 30_000 });
const metadataSql = readFileSync(new URL("../apps/web/server/request-client.ts", import.meta.url), "utf8").match(/`(SELECT p\.proretset AS returns_set,[\s\S]*?)`/)[1];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const commands = (payload = {}, key = randomUUID()) => ({ p_request_id: `setup-test-${randomUUID()}`, p_idempotency_key: key, p_request_hash: hash(payload) });
let scenarios = 0;

async function rpc(client, name, args = {}) {
  const signatures = (await client.query(metadataSql, [name])).rows;
  const signature = signatures.find(row => (row.argument_names ?? []).length === Object.keys(args).length && (row.argument_names ?? []).every(key => Object.hasOwn(args, key)));
  assert.ok(signature, `RPC signature exists: ${name}`);
  const ordered = prepareRpcArguments(args, signature);
  const call = `public."${name}"(${ordered.map(([key], index) => `"${key}" => $${index + 1}`).join(", ")})`;
  const result = await client.query(signature.returns_set ? `SELECT * FROM ${call}` : `SELECT ${call} AS value`, ordered.map(([, value]) => value));
  return normalizeRpcResult(signature.returns_set ? result.rows : result.rows[0]?.value ?? null);
}
async function expectError(client, code, action) {
  await client.query("SAVEPOINT expected_failure");
  try { await assert.rejects(action, error => { assert.equal(error.code, code, error.message); return true; }); }
  finally { await client.query("ROLLBACK TO SAVEPOINT expected_failure"); await client.query("RELEASE SAVEPOINT expected_failure"); }
}
async function identity(client) {
  const id = randomUUID();
  await client.query("INSERT INTO identity.users(id,email_normalized,password_hash,email_verified_at) VALUES($1,$2,$3,now())", [id, `setup-${id}@example.invalid`, "$argon2id$synthetic-fixture-no-login"]);
  await client.query("INSERT INTO identity.auth_sessions(id,user_id,session_version,expires_at,recent_auth_at) VALUES($1,$2,0,now()+interval '1 hour',now())", [randomUUID(), id]);
  await actor(client, id);
  return id;
}
async function actor(client, id) { await client.query("SELECT set_config('ams.actor_user_id',$1,true)", [id]); }
async function company(client) {
  const userId = await identity(client);
  const result = await rpc(client, "create_company_atomic", { p_name: "Synthetic setup test", p_legal_name: "Synthetic setup test company", p_country_code: "BD",
    p_base_currency: "BDT", p_timezone: "Asia/Dhaka", p_fiscal_year_start_month: 1, p_books_start_date: "2026-04-01", p_idempotency_key: randomUUID() });
  return { userId, organizationId: result[0].organization_id, memberId: result[0].owner_member_id };
}
async function state(client, organizationId) { return parseCompanySetup(await rpc(client, "read_company_setup", { p_organization_id: organizationId })); }
function completion(organizationId, overrides = {}) {
  const values = { p_organization_id: organizationId, p_opening_mode: "zero_opening", p_zero_opening_confirmed: true,
    p_opening_document_id: null, p_expected_document_version: null, ...overrides };
  return { ...values, ...commands(values) };
}
async function opening(client, fixture, withControl = false) {
  const accountRows = await rpc(client, "list_accounts_for_management", { p_organization_id: fixture.organizationId });
  const account = code => accountRows.find(value => value.code === code).id;
  let partyId = null;
  if (withControl) {
    const payload = { display_name: "Synthetic opening customer", is_customer: true, is_vendor: false, payment_terms_days: 0,
      credit_limit: null, billing_address: {}, tax_identifiers: {}, is_active: true };
    const contact = await rpc(client, "save_contact", { p_organization_id: fixture.organizationId, p_contact_id: null, p_expected_version: null,
      ...commands(payload), p_payload: payload });
    partyId = contact.id;
    assert.equal(typeof partyId, "string", "saved customer receipt has an ID");
  }
  const debitAccount = account(withControl ? "1100" : "1000");
  const journalRows = [
    { account_id: debitAccount, party_id: partyId, cost_center_id: null, debit: "100.00", credit: "0.00", description: "Synthetic opening debit",
      cash_flow_class: null, open_item_reference: withControl ? "PRIOR-100" : null, open_item_due_date: withControl ? "2026-04-15" : null },
    { account_id: account("3000"), party_id: null, cost_center_id: null, debit: "0.00", credit: "100.00", description: "Synthetic opening capital",
      cash_flow_class: null, open_item_reference: null, open_item_due_date: null }
  ];
  const payload = { document_type: "opening_balance", party_id: null, issue_date: "2026-03-31", accounting_date: "2026-03-31", due_date: null,
    external_reference: "Synthetic prior trial balance", description: "Synthetic opening balances", currency: "BDT", rounding_adjustment: "0.00",
    rounding_reason: null, rounding_account_id: null, trade: null, movement: null, transfer: null, lines: [], journal_rows: journalRows, allocation_plan: [] };
  const args = { p_organization_id: fixture.organizationId, p_document_id: null, p_expected_version: null, ...commands(payload), p_payload: payload,
    p_prior_trial_balance: journalRows.map(({ account_id, debit, credit }) => ({ account_id, debit, credit })), p_ytd_summary: [], p_evidence_reference: "Synthetic prior trial balance" };
  return { args, debitAccount, partyId };
}
async function approve(client, organizationId, document, existingPolicy = null) {
  const roles = await rpc(client, "list_approval_policy_roles", { p_organization_id: organizationId });
  const policy = existingPolicy ?? await rpc(client, "save_approval_policy", { p_organization_id: organizationId, ...commands({ kind: "opening-policy" }), p_policy_id: null,
    p_expected_version: 0, p_name: "Synthetic explicit sole-owner opening review", p_document_type: "opening_balance", p_threshold_amount: "0.00",
    p_approver_role_id: roles.find(role => role.role_name === "Owner").role_id, p_required_approvals: 1, p_allow_self_approval: true, p_is_active: true,
    p_reason: "Synthetic integration fixture explicitly enables sole-owner review." });
  const submitted = await rpc(client, "submit_financial_document", { p_organization_id: organizationId, p_document_id: document.document_id,
    p_expected_version: document.document_version, p_operation: `documents.submit:${document.document_id}`, ...commands({ document }) });
  await rpc(client, "decide_financial_approval", { p_organization_id: organizationId, p_approval_request_id: submitted[0].approval_request_id,
    p_operation: `approvals.decide:${submitted[0].approval_request_id}`, ...commands({ approval: submitted[0].approval_request_id }), p_decision: "approve", p_reason: null });
  return policy;
}
async function scenario(name, run, privileged = false) {
  const client = await (privileged ? adminPool : runtimePool).connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='20s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    await run(client);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    scenarios += 1;
    process.stdout.write(`PASS ${name}${privileged ? " (privileged fault-injection fixture; function actor checks retained)" : " (actual restricted runtime connection)"}\n`);
  } finally { await client.query("ROLLBACK").catch(() => undefined); client.release(); }
}

async function race(name, kind) {
  const preparation = await runtimePool.connect(); let fixture, requests;
  try {
    await preparation.query("BEGIN"); fixture = await company(preparation);
    if (kind === "import") {
      const first = await rpc(preparation, "save_opening_cutover_draft", (await opening(preparation, fixture)).args);
      const second = await rpc(preparation, "save_opening_cutover_draft", (await opening(preparation, fixture)).args);
      const policy = await approve(preparation, fixture.organizationId, first); await approve(preparation, fixture.organizationId, second, policy);
      requests = [first, second].map(document => completion(fixture.organizationId, { p_opening_mode: "import_opening", p_zero_opening_confirmed: false,
        p_opening_document_id: document.document_id, p_expected_document_version: document.document_version }));
    } else { const first = completion(fixture.organizationId); requests = [first, kind === "same" ? first : completion(fixture.organizationId)]; }
    await preparation.query("COMMIT");
  } catch (error) { await preparation.query("ROLLBACK"); throw error; } finally { preparation.release(); }
  let arrived = 0, release; const gate = new Promise(resolve => { release = resolve; });
  async function contender(request) {
    const client = await runtimePool.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='30s'"); await client.query("SET LOCAL lock_timeout='15s'"); await actor(client, fixture.userId);
      const pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      arrived += 1; if (arrived === 2) release(); await gate;
      const result = parseCompleteSetupReceipt(await rpc(client, "complete_company_setup", request)); await client.query("COMMIT"); return { result, pid };
    } catch (error) { await client.query("ROLLBACK"); return { code: error.code, message: error.message }; } finally { client.release(); }
  }
  const results = await Promise.all(requests.map(contender));
  if (kind === "same") { assert.ok(results.every(value => value.result), JSON.stringify(results)); assert.notEqual(results[0].pid, results[1].pid); assert.deepEqual(results[0].result, results[1].result); }
  else { assert.equal(results.filter(value => value.result).length, 1, JSON.stringify(results)); assert.equal(results.find(value => value.code)?.code, "23514", JSON.stringify(results)); }
  const check = await runtimePool.connect();
  try {
    await check.query("BEGIN"); await actor(check, fixture.userId);
    const counts = (await check.query("SELECT (SELECT count(*)::int FROM finance.audit_events WHERE organization_id=$1 AND action='company.setup.complete') AS completions,(SELECT count(*)::int FROM finance.journal_entries WHERE organization_id=$1) AS journals", [fixture.organizationId])).rows[0];
    assert.deepEqual(counts, { completions: 1, journals: kind === "import" ? 1 : 0 }); assert.equal((await state(check, fixture.organizationId)).status, "active");
    await check.query("ROLLBACK");
  } finally { check.release(); }
  scenarios += 1; process.stdout.write(`PASS ${name} (two actual restricted connections; retained synthetic organization ${fixture.organizationId})\n`);
}

try {
  const principal = (await runtimePool.query("SELECT current_user,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(principal.rolsuper, false); assert.equal(principal.rolbypassrls, false); assert.equal(principal.rolcreaterole, false);
  process.stdout.write(`Restricted test role: ${principal.current_user}\n`);

  await scenario("zero opening is explicit, replay-safe, creates no journal, and blocks later opening", async client => {
    const fixture = await company(client), before = await state(client, fixture.organizationId);
    assert.equal(before.status, "onboarding"); assert.equal(before.zeroOpeningAvailable, true);
    assert.ok(before.checks.filter(check => check.required).every(check => check.ready));
    assert.equal(before.checks.find(check => check.code === "cash_account").ready, false);
    await expectError(client, "42501", () => client.query("UPDATE finance.organizations SET status='active' WHERE id=$1", [fixture.organizationId]));
    await expectError(client, "22023", () => rpc(client, "complete_company_setup", completion(fixture.organizationId, { p_zero_opening_confirmed: false })));
    const request = completion(fixture.organizationId);
    const receipt = parseCompleteSetupReceipt(await rpc(client, "complete_company_setup", request));
    assert.equal(receipt.openingMode, "zero_opening");
    assert.deepEqual(parseCompleteSetupReceipt(await rpc(client, "complete_company_setup", request)), receipt);
    await expectError(client, "23505", () => rpc(client, "complete_company_setup", { ...request, p_request_hash: "b".repeat(64) }));
    await expectError(client, "23514", () => rpc(client, "complete_company_setup", completion(fixture.organizationId)));
    assert.equal((await state(client, fixture.organizationId)).status, "active");
    assert.equal((await client.query("SELECT count(*)::int AS total FROM finance.journal_entries WHERE organization_id=$1", [fixture.organizationId])).rows[0].total, 0);
    assert.equal((await client.query("SELECT count(*)::int AS total FROM finance.audit_events WHERE organization_id=$1 AND action='company.setup.complete'", [fixture.organizationId])).rows[0].total, 1);
    const prepared = await opening(client, fixture);
    await expectError(client, "23514", () => rpc(client, "save_opening_cutover_draft", prepared.args));
  });

  await scenario("opening save is atomic and retriable; activation posts approved AR detail exactly once", async client => {
    const fixture = await company(client), prepared = await opening(client, fixture, true);
    await expectError(client, "22023", () => rpc(client, "save_opening_cutover_draft", { ...prepared.args, p_evidence_reference: "" }));
    assert.equal((await state(client, fixture.organizationId)).openingDocuments.length, 0, "summary failure rolls back draft creation");
    const document = await rpc(client, "save_opening_cutover_draft", prepared.args);
    assert.deepEqual(await rpc(client, "save_opening_cutover_draft", prepared.args), document);
    await expectError(client, "23514", () => rpc(client, "complete_company_setup", completion(fixture.organizationId)));
    const request = completion(fixture.organizationId, { p_opening_mode: "import_opening", p_zero_opening_confirmed: false,
      p_opening_document_id: document.document_id, p_expected_document_version: document.document_version });
    await expectError(client, "P0001", () => rpc(client, "complete_company_setup", request));
    await approve(client, fixture.organizationId, document);
    assert.deepEqual(await rpc(client, "save_opening_cutover_draft", prepared.args), document, "lost save response is replayable after approval");
    await expectError(client, "40001", () => rpc(client, "complete_company_setup", { ...request, p_expected_document_version: document.document_version + 1 }));
    const receipt = parseCompleteSetupReceipt(await rpc(client, "complete_company_setup", request));
    assert.equal(receipt.openingMode, "import_opening"); assert.ok(receipt.openingDocumentNumber);
    assert.deepEqual(parseCompleteSetupReceipt(await rpc(client, "complete_company_setup", request)), receipt);
    const posted = await rpc(client, "read_financial_document", { p_organization_id: fixture.organizationId, p_document_id: document.document_id });
    assert.equal(posted.state, "posted");
    const journal = (await client.query("SELECT count(DISTINCT j.id)::int AS journals,sum(l.debit)::text AS debit,sum(l.credit)::text AS credit FROM finance.journal_entries j JOIN finance.journal_lines l ON l.organization_id=j.organization_id AND l.journal_entry_id=j.id WHERE j.organization_id=$1", [fixture.organizationId])).rows[0];
    assert.deepEqual(journal, { journals: 1, debit: "100.00", credit: "100.00" });
    const items = (await client.query("SELECT account_id,party_id,reference,original_amount::text AS amount FROM finance.open_items WHERE organization_id=$1", [fixture.organizationId])).rows;
    assert.deepEqual(items, [{ account_id: prepared.debitAccount, party_id: prepared.partyId, reference: "PRIOR-100", amount: "100.00" }]);
    const another = await opening(client, fixture);
    await expectError(client, "23514", () => rpc(client, "save_opening_cutover_draft", another.args));
  });

  await scenario("cross-tenant owner and missing actor cannot read or complete another company", async client => {
    const first = await company(client), second = await company(client);
    await expectError(client, "42501", () => rpc(client, "read_company_setup", { p_organization_id: first.organizationId }));
    await expectError(client, "42501", () => rpc(client, "complete_company_setup", completion(first.organizationId)));
    await actor(client, first.userId);
    await expectError(client, "P0002", () => rpc(client, "complete_company_setup", completion(first.organizationId, { p_opening_mode: "import_opening",
      p_zero_opening_confirmed: false, p_opening_document_id: randomUUID(), p_expected_document_version: 1 })));
    await actor(client, "");
    await expectError(client, "28000", () => rpc(client, "read_company_setup", { p_organization_id: second.organizationId }));
  });

  await scenario("missing mapping blocks activation without creating completion evidence", async client => {
    const fixture = await company(client);
    await client.query("DELETE FROM finance.account_mappings WHERE organization_id=$1 AND mapping_key='ar'", [fixture.organizationId]);
    assert.equal((await state(client, fixture.organizationId)).checks.find(check => check.code === "account_mappings").ready, false);
    await expectError(client, "23514", () => rpc(client, "complete_company_setup", completion(fixture.organizationId)));
    assert.equal((await state(client, fixture.organizationId)).completion, null);
  }, true);

  await scenario("late opening-posting failure rolls back status, completion, journal and receipt", async client => {
    const fixture = await company(client), prepared = await opening(client, fixture);
    const document = await rpc(client, "save_opening_cutover_draft", prepared.args);
    await approve(client, fixture.organizationId, document);
    // A stale approved digest is deliberately injected as a privileged fixture;
    // the real runtime command must reject it after attempting activation.
    await client.query("UPDATE finance.approval_requests SET document_digest=$1 WHERE organization_id=$2 AND document_id=$3", ["b".repeat(64), fixture.organizationId, document.document_id]);
    await expectError(client, "40001", () => rpc(client, "complete_company_setup", completion(fixture.organizationId, { p_opening_mode: "import_opening",
      p_zero_opening_confirmed: false, p_opening_document_id: document.document_id, p_expected_document_version: document.document_version })));
    const after = await state(client, fixture.organizationId);
    assert.equal(after.status, "onboarding"); assert.equal(after.completion, null);
    assert.equal((await client.query("SELECT count(*)::int AS total FROM finance.journal_entries WHERE organization_id=$1", [fixture.organizationId])).rows[0].total, 0);
    assert.equal((await client.query("SELECT count(*)::int AS total FROM finance.idempotency_requests WHERE organization_id=$1 AND operation='company.setup.complete'", [fixture.organizationId])).rows[0].total, 0);
  }, true);

  await scenario("completion evidence is immutable and a non-owner Admin cannot activate", async client => {
    const fixture = await company(client);
    await rpc(client, "complete_company_setup", completion(fixture.organizationId));
    await expectError(client, "23514", () => client.query("UPDATE finance_private.company_setup_completions SET opening_mode='zero_opening' WHERE organization_id=$1", [fixture.organizationId]));
    await expectError(client, "23514", () => client.query("DELETE FROM finance_private.company_setup_completions WHERE organization_id=$1", [fixture.organizationId]));
    const second = await company(client), adminUser = await identity(client);
    const memberId = randomUUID();
    await client.query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot,status) VALUES($1,$2,$3,'Synthetic Admin','active')", [memberId, second.organizationId, adminUser]);
    await client.query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) SELECT $1,$2,r.id FROM finance.roles r WHERE r.organization_id=$1 AND r.template_key='admin'", [second.organizationId, memberId]);
    await expectError(client, "42501", () => rpc(client, "complete_company_setup", completion(second.organizationId)));
  }, true);
  await race("same-key concurrent zero setup returns the same receipt without a journal", "same");
  await race("different-key concurrent zero setup completes once and rejects the competitor", "different");
  await race("competing approved opening documents activate once and post one journal", "import");
  process.stdout.write(`PASS ${scenarios} company-setup integration scenarios; 6 rollback fixtures and 3 retained synthetic race companies.\n`);
} finally { await Promise.all([runtimePool.end(), adminPool.end()]); }
