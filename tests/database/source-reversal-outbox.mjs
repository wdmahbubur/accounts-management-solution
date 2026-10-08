// Run from the repository root after migration 0091, against an isolated database only:
// AMS_DATABASE_TESTS=isolated TEST_REVERSAL_ORGANIZATION_ID=<uuid> TEST_REVERSAL_DOCUMENT_ID=<uuid> \
//   node tests/database/source-reversal-outbox.mjs
// The selected source must be a synthetic, eligible posted invoice owned by the verified demo.
// TEST_REVERSAL_DATE optionally selects an open date on/after its accounting date.
// Owner/runtime URLs use TEST_DATABASE_* overrides or the ignored local configuration.
// Every transaction, including successful reversals and private guard probes, rolls back.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool, neonConfig, types } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { DEMO_ACCOUNT_EMAIL } from "../../apps/web/server/auth/demo-login.ts";
import { hashCanonicalRequest } from "../../apps/web/server/commands/request-context.ts";

assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Explicitly select the isolated test database.");
const organizationId = process.env.TEST_REVERSAL_ORGANIZATION_ID;
const sourceId = process.env.TEST_REVERSAL_DOCUMENT_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
assert.ok(uuid.test(organizationId ?? "") && uuid.test(sourceId ?? ""), "Select explicit synthetic organization and source UUIDs.");
const ownerUrl = process.env.TEST_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
const runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL ?? process.env.DATABASE_RUNTIME_URL;
assert.ok(ownerUrl && runtimeUrl, "Configure isolated owner and restricted runtime connections.");
let targetsMatch = false;
try {
  const owner = new URL(ownerUrl), runtime = new URL(runtimeUrl);
  targetsMatch = owner.hostname === runtime.hostname && owner.pathname === runtime.pathname
    && decodeURIComponent(runtime.username) === "ams_app_login";
} catch { /* Do not expose an invalid URL in an exception. */ }
assert.ok(targetsMatch, "Owner and actual ams_app_login must target the same isolated database.");
neonConfig.webSocketConstructor = WebSocket;
types.setTypeParser(types.builtins.DATE, value => value);
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 30_000 });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 30_000 });
let owner, runtime, actorId, date, stage = "connect", checks = 0;
const receipts = [];
const report = check => { checks++; process.stdout.write(`${JSON.stringify({ check, status: "passed" })}\n`); };
const reason = "Synthetic reversal regression; this transaction always rolls back.";
const reverseSql = "SELECT * FROM public.reverse_posted_document($1::uuid,$2::uuid,$3::date,$4::text,$5::text,$6::text,$7::text)";
const enqueueSql = "SELECT finance_private.enqueue_outbox_event($1::uuid,$2::text,$3::uuid,$4::text,$5::jsonb) AS id";

async function begin(client, readOnly = false) {
  await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
  await client.query("SET LOCAL statement_timeout = '20s'");
  await client.query("SET LOCAL lock_timeout = '5s'");
}
async function setActor(client, actor = actorId) {
  await client.query("SELECT set_config('ams.actor_user_id',$1,true)", [actor ?? ""]);
}
async function expectSqlState(client, code, sql, values) {
  await client.query("SAVEPOINT expected_rejection");
  try {
    await assert.rejects(client.query(sql, values), error => error?.code === code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_rejection");
    await client.query("RELEASE SAVEPOINT expected_rejection");
  }
}
function reversalArgs(key = randomUUID(), correctionReason = reason) {
  return [organizationId, sourceId, date, correctionReason, randomUUID(), key, hashCanonicalRequest({
    operation: `documents.reverse:${sourceId}`, organizationId, payload: { reversalDate: date, reason: correctionReason }
  })];
}
async function financialEvidence(client) {
  return (await client.query(`WITH sources AS (
    SELECT id FROM finance.business_documents WHERE organization_id=$1 AND (id=$2 OR reversal_of_document_id=$2)
  ), entries AS (
    SELECT id FROM finance.journal_entries WHERE organization_id=$1 AND source_document_id IN (SELECT id FROM sources)
  ), lines AS (
    SELECT id FROM finance.journal_lines WHERE organization_id=$1 AND journal_entry_id IN (SELECT id FROM entries)
  ), items AS (
    SELECT id FROM finance.open_items WHERE organization_id=$1 AND journal_line_id IN (SELECT id FROM lines)
  ), allocations AS (
    SELECT id FROM finance.settlement_allocations WHERE organization_id=$1
      AND (debit_open_item_id IN (SELECT id FROM items) OR credit_open_item_id IN (SELECT id FROM items))
  ) SELECT jsonb_build_object(
    'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM finance.business_documents d WHERE organization_id=$1 AND id IN (SELECT id FROM sources)),
    'journals',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM finance.journal_entries j WHERE organization_id=$1 AND id IN (SELECT id FROM entries)),
    'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE organization_id=$1 AND id IN (SELECT id FROM lines)),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM finance.open_items i WHERE organization_id=$1 AND id IN (SELECT id FROM items)),
    'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM finance.settlement_allocations a WHERE organization_id=$1 AND id IN (SELECT id FROM allocations)),
    'unapplies',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM finance.allocation_reversals r WHERE organization_id=$1 AND allocation_id IN (SELECT id FROM allocations))
  ) AS value`, [organizationId, sourceId])).rows[0].value;
}
async function privateEvidence(client) {
  return (await client.query(`SELECT jsonb_build_object(
    'outbox',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM finance.outbox_events e WHERE organization_id=$1
      AND (document_id=$2 OR payload->>'source_document_id'=$2::text)),
    'requests',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM finance.idempotency_requests i
      WHERE organization_id=$1 AND operation='documents.reverse:'||$2::text),
    'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM finance.audit_events a WHERE organization_id=$1
      AND (document_id=$2 OR redacted_change->'after'->>'source_document_id'=$2::text))
  ) AS value`, [organizationId, sourceId])).rows[0].value;
}

try {
  owner = await ownerPool.connect();
  runtime = await runtimePool.connect();
  stage = "restricted login verification";
  const role = (await runtime.query(`SELECT current_user, session_user=current_user AS direct_login,
    NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AS restricted,
    pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime_member,
    has_table_privilege(current_user,'finance.journal_lines','INSERT') AS direct_ledger_insert,
    has_function_privilege(current_user,'finance_private.enqueue_outbox_event(uuid,text,uuid,text,jsonb)','EXECUTE') AS direct_enqueue
    FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`)).rows[0];
  assert.equal(role.current_user, "ams_app_login");
  assert.ok(role.direct_login && role.restricted && role.runtime_member && !role.direct_ledger_insert && !role.direct_enqueue);

  stage = "synthetic source preflight";
  await begin(owner, true);
  const demo = await owner.query(`SELECT DISTINCT u.id FROM identity.users u
    JOIN finance.organization_members m ON m.user_id=u.id AND m.organization_id=$2 AND m.status='active'
    JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
    JOIN finance.roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id AND r.template_key='owner'
    WHERE u.email_normalized=$1 AND u.disabled_at IS NULL AND u.email_verified_at IS NOT NULL`, [DEMO_ACCOUNT_EMAIL, organizationId]);
  assert.equal(demo.rowCount, 1, "The verified synthetic demo must own the selected company.");
  actorId = demo.rows[0].id;
  const source = (await owner.query("SELECT id,state,document_type,accounting_date::text FROM finance.business_documents WHERE organization_id=$1 AND id=$2", [organizationId, sourceId])).rows[0];
  assert.ok(source && source.state === "posted" && source.document_type === "invoice", "Select an eligible posted synthetic invoice.");
  date = process.env.TEST_REVERSAL_DATE ?? source.accounting_date;
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(date >= source.accounting_date, "The test reversal cannot predate its source.");
  const baseline = await financialEvidence(owner);
  assert.equal(baseline.documents.length, 1, "The source must have no existing reversal.");
  const privateBaseline = await privateEvidence(owner);
  await owner.query("ROLLBACK");
  report("actual restricted login and explicit eligible synthetic source");

  stage = "runtime permission denials";
  await begin(runtime);
  await setActor(runtime, null);
  await expectSqlState(runtime, "28000", reverseSql, reversalArgs());
  await setActor(runtime);
  const wrongCompany = reversalArgs();
  wrongCompany[0] = randomUUID();
  await expectSqlState(runtime, "42501", reverseSql, wrongCompany);
  await expectSqlState(runtime, "42501", enqueueSql, [organizationId, "document.reversed", sourceId, randomUUID(), "{}"]);
  report("anonymous, unauthorized-company and direct private enqueue requests denied");

  stage = "restricted reversal and exact journal";
  await runtime.query("SAVEPOINT source_reversal");
  const args = reversalArgs();
  const receipt = (await runtime.query(reverseSql, args)).rows[0];
  receipts.push(receipt);
  assert.equal(receipt.state, "posted");
  assert.equal(receipt.reversal_date, date);
  assert.ok(uuid.test(receipt.reversal_document_id) && uuid.test(receipt.journal_entry_id));
  await runtime.query("SET CONSTRAINTS ALL IMMEDIATE");
  const after = await financialEvidence(runtime);
  assert.equal(after.documents.length, 2);
  assert.deepEqual(after.documents.find(row => row.id === sourceId), baseline.documents[0], "The posted source must remain byte-for-byte unchanged.");
  const originalLines = baseline.lines.map(({ line_no, account_id, party_id, cost_center_id, cash_flow_class, debit, credit }) => ({
    line_no, account_id, party_id, cost_center_id, cash_flow_class, debit, credit
  })).sort((a, b) => a.line_no - b.line_no);
  // Numeric values are compared in SQL; the driver never becomes a money authority.
  const inverse = (await runtime.query(`SELECT count(*)::integer AS line_count,
    bool_and(r.account_id=s.account_id AND r.party_id IS NOT DISTINCT FROM s.party_id
      AND r.cost_center_id IS NOT DISTINCT FROM s.cost_center_id AND r.cash_flow_class IS NOT DISTINCT FROM s.cash_flow_class
      AND r.debit=s.credit AND r.credit=s.debit) AS exact
    FROM finance.journal_lines s JOIN finance.journal_lines r
      ON r.organization_id=s.organization_id AND r.line_no=s.line_no AND r.journal_entry_id=$3
    WHERE s.organization_id=$1 AND s.journal_entry_id=$2`, [organizationId, baseline.journals[0].id, receipt.journal_entry_id])).rows[0];
  assert.equal(inverse.line_count, originalLines.length);
  assert.equal(after.lines.length, baseline.lines.length * 2);
  assert.equal(inverse.exact, true);
  report("reversal posts an exact inverse journal and passes all deferred constraints");

  stage = "reversal retries and rollback";
  const replay = (await runtime.query(reverseSql, [...args.slice(0, 4), randomUUID(), ...args.slice(5)])).rows[0];
  assert.deepEqual(replay, receipt);
  assert.deepEqual(await financialEvidence(runtime), after, "Same-key retry must add no financial rows.");
  await expectSqlState(runtime, "23505", reverseSql, reversalArgs(args[5], `${reason} Changed request.`));
  await expectSqlState(runtime, "P0001", reverseSql, reversalArgs());
  await runtime.query("ROLLBACK TO SAVEPOINT source_reversal");
  await runtime.query("RELEASE SAVEPOINT source_reversal");
  assert.deepEqual(await financialEvidence(runtime), baseline, "Rolling back the successful command must restore all related financial facts.");
  await runtime.query("ROLLBACK");
  report("same-key retry, changed-key rejection and full financial rollback");

  // The runtime deliberately cannot read the outbox. Repeat the same public RPC in an
  // owner transaction only to inspect private event/receipt evidence; no grants change.
  stage = "transactional outbox and receipt evidence";
  await begin(owner);
  await setActor(owner);
  assert.deepEqual(await financialEvidence(owner), baseline);
  assert.deepEqual(await privateEvidence(owner), privateBaseline, "Runtime rollback must remove the outbox, audit and idempotency receipt too.");
  const ownerArgs = reversalArgs();
  const ownerReceipt = (await owner.query(reverseSql, ownerArgs)).rows[0];
  receipts.push(ownerReceipt);
  await owner.query("SET CONSTRAINTS ALL IMMEDIATE");
  const event = await owner.query(`SELECT event_type,document_id,deduplication_key,payload,status,attempt_count
    FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2`, [organizationId, ownerReceipt.reversal_document_id]);
  assert.deepEqual(event.rows, [{ event_type: "document.reversed", document_id: ownerReceipt.reversal_document_id,
    deduplication_key: `document.reversed:${ownerReceipt.reversal_document_id}`, status: "pending", attempt_count: 0,
    payload: { source_document_id: sourceId, reversal_document_id: ownerReceipt.reversal_document_id,
      journal_entry_id: ownerReceipt.journal_entry_id, effective_date: date } }]);
  const retry = (await owner.query(reverseSql, [...ownerArgs.slice(0, 4), randomUUID(), ...ownerArgs.slice(5)])).rows[0];
  assert.deepEqual(retry, ownerReceipt);
  const counted = (await owner.query(`SELECT
    (SELECT count(*)::integer FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2) AS outbox,
    (SELECT count(*)::integer FROM finance.idempotency_requests WHERE organization_id=$1 AND resource_document_id=$2) AS receipts,
    (SELECT count(*)::integer FROM finance.audit_events WHERE organization_id=$1 AND document_id=$2 AND action='document.reverse') AS audit`, [organizationId, ownerReceipt.reversal_document_id])).rows[0];
  assert.deepEqual(counted, { outbox: 1, receipts: 1, audit: 1 });
  report("one immutable pending reversal event, audit and idempotency receipt on retry");

  stage = "preserved outbox guards";
  const selected = event.rows[0];
  const validArgs = [organizationId, selected.event_type, selected.document_id, selected.deduplication_key, JSON.stringify(selected.payload)];
  const originalEventId = (await owner.query(enqueueSql, validArgs)).rows[0].id;
  assert.equal((await owner.query(enqueueSql, validArgs)).rows[0].id, originalEventId);
  for (const [type, documentId, payload] of [
    ["document.posted", selected.document_id, selected.payload],
    [selected.event_type, sourceId, selected.payload],
    [selected.event_type, selected.document_id, { ...selected.payload, effective_date: "2026-01-01" }]
  ]) {
    await expectSqlState(owner, "23505", enqueueSql, [organizationId, type, documentId, selected.deduplication_key, JSON.stringify(payload)]);
  }
  const rejectedPayloads = [null, [], "scalar", { nested: [{ api_token: "synthetic-only" }] },
    { envelope: { password: "synthetic-only" } }, { file_content: "synthetic-only" }, { message: "x".repeat(32769) }];
  for (const payload of rejectedPayloads) {
    await expectSqlState(owner, "22023", enqueueSql, [organizationId, selected.event_type, selected.document_id, randomUUID(), JSON.stringify(payload)]);
  }
  await expectSqlState(owner, "22023", enqueueSql, [organizationId, "document.unsupported", selected.document_id, randomUUID(), "{}"]);
  for (const key of [null, "", "x".repeat(201)]) {
    await expectSqlState(owner, "22023", enqueueSql, [organizationId, selected.event_type, selected.document_id, key, "{}"]);
  }
  const unchanged = await owner.query(`SELECT event_type,document_id,deduplication_key,payload,status,attempt_count
    FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2`, [organizationId, ownerReceipt.reversal_document_id]);
  assert.deepEqual(unchanged.rows, event.rows);
  await owner.query("ROLLBACK");
  report("dedupe identity, event allowlist, object/size limits and recursive secret guards preserved");

  stage = "final rollback evidence";
  await begin(owner, true);
  assert.deepEqual(await financialEvidence(owner), baseline);
  assert.deepEqual(await privateEvidence(owner), privateBaseline);
  const remaining = (await owner.query(`SELECT
    (SELECT count(*)::integer FROM finance.business_documents WHERE organization_id=$1 AND id=ANY($2::uuid[])) AS documents,
    (SELECT count(*)::integer FROM finance.journal_entries WHERE organization_id=$1 AND source_document_id=ANY($2::uuid[])) AS journals,
    (SELECT count(*)::integer FROM finance.outbox_events WHERE organization_id=$1 AND document_id=ANY($2::uuid[])) AS events,
    (SELECT count(*)::integer FROM finance.idempotency_requests WHERE organization_id=$1 AND resource_document_id=ANY($2::uuid[])) AS receipts`,
  [organizationId, receipts.map(receipt => receipt.reversal_document_id)])).rows[0];
  assert.deepEqual(remaining, { documents: 0, journals: 0, events: 0, receipts: 0 });
  await owner.query("ROLLBACK");
  report("both successful test reversals and all private probes rolled back completely");
  process.stdout.write(`${JSON.stringify({ result: "passed", checks, rollbackOnly: true })}\n`);
} catch (error) {
  if (error.code === "ERR_ASSERTION") throw error;
  const sqlState = typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "unavailable";
  throw new Error(`Reversal regression failed during ${stage}; SQLSTATE ${sqlState}. Connection details are not printed.`);
} finally {
  try { if (runtime) await runtime.query("ROLLBACK"); }
  finally {
    try { if (owner) await owner.query("ROLLBACK"); }
    finally {
      runtime?.release(); owner?.release();
      await Promise.all([runtimePool.end(), ownerPool.end()]);
    }
  }
}
