// Run after migration 0090, using an explicitly selected isolated test database.
// Fixture writes use a unique synthetic organization. Reads use the real restricted login.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { neonConfig, Pool, types } from "@neondatabase/serverless";

const ownerUrl = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL;
if (!ownerUrl || !runtimeUrl) throw new Error("Set TEST_DATABASE_URL and TEST_DATABASE_RUNTIME_URL for an isolated database migrated through 0090.");
const ownerTarget = new URL(ownerUrl), runtimeTarget = new URL(runtimeUrl);
if (ownerTarget.hostname !== runtimeTarget.hostname || ownerTarget.pathname !== runtimeTarget.pathname || decodeURIComponent(runtimeTarget.username) !== "ams_app_login") {
  throw new Error("Test owner and actual ams_app_login must target the same isolated database.");
}
types.setTypeParser(types.builtins.DATE, value => value);
neonConfig.webSocketConstructor = WebSocket;
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 30_000 });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 30_000 });
const ownerId = randomUUID(), sourceReader = randomUUID(), salesReader = randomUUID(), ledgerReader = randomUUID(), outsider = randomUUID();
const run = randomUUID(), date = "2026-10-08";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let organizationId, checks = 0;
const report = check => { checks++; process.stdout.write(`${JSON.stringify({ check, status: "passed" })}\n`); };
const ownerQuery = (sql, args = []) => ownerPool.query(sql, args);

async function asActor(userId, work, readOnly = false) {
  const client = await runtimePool.connect();
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)", [userId]);
    const result = await work(client);
    await client.query(readOnly ? "ROLLBACK" : "COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

async function evidence() {
  return (await ownerQuery(`SELECT jsonb_build_object(
    'sources',(SELECT jsonb_agg(jsonb_build_array(id,state,version,material_digest,document_number,total_amount::text,party_snapshot) ORDER BY id) FROM finance.business_documents WHERE organization_id=$1),
    'numbers',(SELECT jsonb_agg(jsonb_build_array(document_type,next_value) ORDER BY document_type) FROM finance.document_sequences WHERE organization_id=$1),
    'journals',(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1),
    'lines',(SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1),
    'open_items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),
    'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),
    'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),
    'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),
    'idempotency',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1)
  ) AS data`, [organizationId])).rows[0].data;
}

async function read(userId, documentId, organization = organizationId) {
  const before = await evidence();
  const result = await asActor(userId, client => client.query("SELECT public.read_financial_document($1::uuid,$2::uuid) AS document", [organization, documentId]), true);
  assert.deepEqual(await evidence(), before, "detail reads must not change financial, numbering, version, audit, outbox or idempotency evidence");
  return result.rows[0].document;
}

async function save(payload) {
  const key = randomUUID();
  const result = await asActor(ownerId, client => client.query("SELECT * FROM public.save_financial_document($1::uuid,NULL::uuid,NULL::integer,$2::text,$3::text,$4::text,$5::jsonb)",
    [organizationId, `detail_${key}`, key, hash(payload), JSON.stringify(payload)]));
  return result.rows[0];
}

async function post(document) {
  let key = randomUUID();
  const submitted = await asActor(ownerId, client => client.query("SELECT * FROM public.submit_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::text)",
    [organizationId, document.document_id, document.document_version, `documents.submit:${document.document_id}`, `detail_${key}`, key, hash(document)]));
  assert.equal(submitted.rows[0].state, "approved");
  key = randomUUID();
  await asActor(ownerId, client => client.query("SELECT * FROM public.post_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text)",
    [organizationId, document.document_id, submitted.rows[0].document_version, `detail_${key}`, key, hash(document)]));
}

async function assertJournal(documentId, result) {
  const expected = (await ownerQuery(`SELECT l.id AS line_id,l.line_no,l.account_id,a.code AS account_code,a.name AS account_name,l.party_id,
      l.description,l.cost_center_id,cc.code AS cost_center_code,cc.name AS cost_center_name,l.debit::text,l.credit::text,l.cash_flow_class::text,
      oi.id AS open_item_id,oi.reference AS open_item_reference,oi.due_date::text AS open_item_due_date
    FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
    LEFT JOIN finance.cost_centers cc ON cc.organization_id=l.organization_id AND cc.id=l.cost_center_id
    LEFT JOIN finance.open_items oi ON oi.organization_id=l.organization_id AND oi.journal_line_id=l.id
    WHERE j.organization_id=$1 AND j.source_document_id=$2 AND j.state='posted' ORDER BY l.line_no`, [organizationId, documentId])).rows;
  assert.ok(expected.length > 0);
  assert.equal(result.posted_journal.lines.length, expected.length);
  assert.deepEqual(result.posted_journal.lines.map(line => {
    const financialLine = { ...line };
    delete financialLine.party_name;
    return financialLine;
  }), expected);
}

try {
  const role = (await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole,pg_has_role(current_user,'ams_runtime','member') AS runtime_member FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  assert.equal(role.current_user, "ams_app_login");
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false); assert.equal(role.rolcreaterole, false); assert.equal(role.runtime_member, true);
  for (const [id, name] of [[ownerId, "Detail QA owner"], [sourceReader, "Source reader"], [salesReader, "Sales reader"], [ledgerReader, "Ledger reader"], [outsider, "Unrelated reader"]]) {
    await ownerQuery("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [id, `detail-${id}@example.invalid`, name, "$argon2id$synthetic-unusable-test-hash"]);
    await ownerQuery("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')", [id, name]);
  }
  const company = await asActor(ownerId, client => client.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$2)", [`Document detail QA ${run}`, run]));
  organizationId = company.rows[0].organization_id;
  // Synthetic fixture activation only; this verifier does not exercise or bypass production setup.
  await ownerQuery("UPDATE finance.organizations SET status='active',updated_at=now() WHERE id=$1", [organizationId]);
  const accounts = Object.fromEntries((await ownerQuery("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [organizationId])).rows.map(row => [row.code, row.id]));
  const ownerRole = (await ownerQuery("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [organizationId])).rows[0].id;
  for (const [userId, name, permissions] of [[sourceReader, "Document-only reader", ["documents.read"]], [salesReader, "Sales-only reader", ["sales.read"]], [ledgerReader, "Source and ledger reader", ["documents.read", "ledger.read"]]]) {
    const member = randomUUID(), roleId = randomUUID();
    await ownerQuery("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)", [member, organizationId, userId, name]);
    await ownerQuery("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)", [roleId, organizationId, name]);
    await ownerQuery("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])", [organizationId, roleId, permissions]);
    await ownerQuery("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [organizationId, member, roleId]);
  }
  const customer = randomUUID(), cashA = randomUUID(), cashB = randomUUID(), center = randomUUID();
  await ownerQuery("INSERT INTO finance.contacts(id,organization_id,display_name,legal_name,email,billing_address,tax_identifiers,is_customer,is_vendor) VALUES($1,$2,'Original issued customer','Original legal name','issued@example.invalid',$3::jsonb,$4::jsonb,true,false)", [customer, organizationId, JSON.stringify({line1:"Original address",city:"Dhaka"}), JSON.stringify({tin:"QA-ORIGINAL"})]);
  await ownerQuery("INSERT INTO finance.cost_centers(id,organization_id,code,name) VALUES($1,$2,'DETAIL','Detail QA center')", [center, organizationId]);
  await ownerQuery("INSERT INTO finance.cash_accounts(id,organization_id,name,kind,account_id,masked_account_number,is_cash_equivalent,allow_negative_balance) VALUES($1,$3,'Detail bank A','bank',$4,'DO-NOT-EXPOSE-A',true,false),($2,$3,'Detail bank B','bank',$5,'DO-NOT-EXPOSE-B',true,false)", [cashA, cashB, organizationId, accounts["1010"], accounts["1020"]]);
  for (const type of ["invoice", "manual_journal", "transfer"]) {
    const key = randomUUID();
    await asActor(ownerId, client => client.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,$8)", [organizationId, `detail_${key}`, key, hash(type), `Detail ${type}`, type, ownerRole, "Synthetic read-model verification policy"]));
  }
  const base = { party_id: null, issue_date: date, accounting_date: date, due_date: null, description: "Synthetic detail evidence", external_reference: "DETAIL-QA", currency: "BDT", rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null, trade: null, movement: null, transfer: null, lines: [], journal_rows: [], allocation_plan: [] };
  const journalRow = (account_id, debit, credit, description, extras = {}) => ({ account_id, debit, credit, description, party_id: null, cost_center_id: null, cash_flow_class: null, open_item_reference: null, open_item_due_date: null, ...extras });
  const manual = await save({ ...base, document_type: "manual_journal", journal_rows: [
    journalRow(accounts["1010"], "500.00", "0.00", "Cash contribution", {cash_flow_class:"financing"}),
    journalRow(accounts["6000"], "25.25", "0.00", "Exact expense", {cost_center_id:center}),
    journalRow(accounts["3000"], "0.00", "525.25", "Opening contribution")
  ] });
  await post(manual);
  const line = (amount, description) => ({ id: null, item_id: null, original_line_id: null, description, quantity: "1.000000", unit_price: `${amount}0000`, discount_amount: "0.00", account_id: accounts["4000"], cost_center_id: center, tax_code_id: null, tax_mode: "exclusive", cash_flow_class: null });
  const invoice = await save({ ...base, document_type: "invoice", party_id: customer, due_date:"2026-10-31", trade:{recognition_mode:"earned_or_incurred",performance_confirmed:true,terms:"Original terms",notes:"Original note"}, lines:[line("1250.37","First service"),line("1.01","Second service")] });
  await post(invoice);
  const transfer = await save({ ...base, document_type:"transfer", transfer:{from_cash_account_id:cashA,to_cash_account_id:cashB,amount:"40.25",fee_amount:"0.13",fee_account_id:accounts["6000"]} });
  await post(transfer);
  const receipt = await save({ ...base, document_type:"receipt", party_id:customer, movement:{cash_account_id:cashA,direction:"in",amount:"10.01",method:"bank_transfer",reference:"RECEIPT-DETAIL",cash_flow_class:"operating"} });
  report("unique committed fixtures created through actual runtime save/approval/post commands; ordinary login verified");

  const beforeInvoice = await read(ledgerReader, invoice.document_id);
  await assertJournal(invoice.document_id, beforeInvoice);
  assert.equal(beforeInvoice.total_amount, "1251.38");
  assert.equal(beforeInvoice.lines.length, 2); assert.equal(beforeInvoice.posted_journal.lines.length, 3);
  assert.equal(beforeInvoice.posted_journal.lines.find(row => row.party_id === customer).party_name, "Original issued customer");
  assert.equal(beforeInvoice.posted_journal.lines.find(row => row.party_id === customer).open_item_due_date, "2026-10-31");
  assert.equal(beforeInvoice.lines[0].account_code, "4000");
  report("ledger reader receives every exact invoice journal line, account label, memo, cost center and open-item reference/date");

  for (const reader of [sourceReader, salesReader]) {
    const source = await read(reader, invoice.document_id);
    assert.equal(source.posted_journal, null);
    assert.deepEqual(source.lines, beforeInvoice.lines);
    assert.deepEqual(source.party_snapshot, beforeInvoice.party_snapshot);
    assert.equal(source.version, beforeInvoice.version); assert.equal(source.material_digest, beforeInvoice.material_digest); assert.equal(source.total_amount, beforeInvoice.total_amount);
  }
  report("document-only and sales-only readers retain complete source evidence but receive no posted journal");

  const manualLedger = await read(ledgerReader, manual.document_id); await assertJournal(manual.document_id, manualLedger);
  const manualSource = await read(sourceReader, manual.document_id);
  assert.equal(manualSource.posted_journal, null); assert.deepEqual(manualSource.journal_rows, manualLedger.journal_rows);
  assert.equal(manualSource.journal_rows.length, 3); assert.equal(manualSource.journal_rows[1].debit, "25.25");
  assert.equal(manualSource.journal_rows[1].cost_center_name, "Detail QA center");
  const transferLedger = await read(ledgerReader, transfer.document_id); await assertJournal(transfer.document_id, transferLedger);
  const transferSource = await read(sourceReader, transfer.document_id);
  assert.equal(transferSource.posted_journal, null); assert.deepEqual(transferSource.transfer, transferLedger.transfer);
  assert.equal(transferSource.total_amount,"40.38"); assert.equal(transferSource.transfer.from_cash_account_name,"Detail bank A"); assert.equal(transferSource.transfer.to_cash_account_name,"Detail bank B"); assert.equal(transferSource.transfer.fee_account_code,"6000");
  const movement = await read(salesReader, receipt.document_id);
  assert.equal(movement.movement.cash_account_name,"Detail bank A"); assert.equal(movement.movement.amount,"10.01"); assert.equal(movement.movement.reference,"RECEIPT-DETAIL");
  for (const source of [manualSource, transferSource, movement]) assert.equal(JSON.stringify(source).includes("DO-NOT-EXPOSE"),false);
  report("manual, transfer and movement source details stay complete and readable without bank numbers or unrelated balances");

  await ownerQuery("UPDATE finance.contacts SET display_name='Changed live customer',legal_name='Changed legal name',billing_address=$3::jsonb,tax_identifiers=$4::jsonb WHERE organization_id=$1 AND id=$2", [organizationId,customer,JSON.stringify({line1:"Changed address"}),JSON.stringify({tin:"CHANGED"})]);
  await ownerQuery("UPDATE finance.accounts SET is_active=false,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [organizationId,accounts["4000"]]);
  const historical = await read(ledgerReader, invoice.document_id);
  assert.deepEqual(historical, beforeInvoice);
  assert.equal(JSON.stringify(historical).includes("Changed live customer"),false);
  report("contact changes and account archival preserve issued snapshot, exact amounts, version, digest and historical labels");

  const foreign = await asActor(ownerId, client => client.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$2)", [`Other detail QA ${run}`, randomUUID()]));
  const otherOrganization = foreign.rows[0].organization_id;
  const noEffects = await evidence();
  for (const [user, org, doc] of [[ownerId,otherOrganization,invoice.document_id],[sourceReader,otherOrganization,invoice.document_id],[outsider,organizationId,invoice.document_id],[ledgerReader,organizationId,randomUUID()]]) {
    await assert.rejects(() => asActor(user, client => client.query("SELECT public.read_financial_document($1::uuid,$2::uuid)",[org,doc]),true),error => error?.code === "P0002");
  }
  assert.deepEqual(await evidence(),noEffects);
  report("cross-company IDs, missing membership and absent sources disclose no metadata and leave no effects");
  process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:organizationId,invoice_id:invoice.document_id,manual_journal_id:manual.document_id,transfer_id:transfer.document_id,receipt_id:receipt.document_id,note:"Only new synthetic fixtures were changed; committed posting evidence is retained. No reset, production or provider calls."})}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({result:"failed",checks,organization_id:organizationId,code:error?.code,message:error instanceof Error?error.message:String(error)})}\n`);
  process.exitCode = 1;
} finally { await Promise.all([ownerPool.end(),runtimePool.end()]); }
