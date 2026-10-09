// Isolated database only, migrated through 0093. Uses the actual restricted login.
// AMS_DATABASE_TESTS=isolated node tests/database/credit-note-sources.mjs
// Privileged writes create only unique synthetic identities/roles/master data.
// Source save/approval/post/reversal and all tested reads run as ams_app_login.
// Committed synthetic fixtures are retained for evidence; failed commands roll back.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { neonConfig, Pool, types } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";

assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Explicitly select an isolated test database.");
const ownerUrl = process.env.TEST_DATABASE_URL, runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL;
assert.ok(ownerUrl && runtimeUrl, "Set both TEST_DATABASE_URL and TEST_DATABASE_RUNTIME_URL.");
let targetsMatch = false;
try {
  const owner = new URL(ownerUrl), runtime = new URL(runtimeUrl);
  targetsMatch = owner.hostname === runtime.hostname && owner.pathname === runtime.pathname && decodeURIComponent(runtime.username) === "ams_app_login";
} catch { /* Never print connection strings. */ }
assert.ok(targetsMatch, "Owner and actual ams_app_login must target the same isolated database.");
neonConfig.webSocketConstructor = WebSocket;
types.setTypeParser(types.builtins.DATE, value => value);
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 30_000 });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 2, connectionTimeoutMillis: 30_000 });
const run = randomUUID(), ownerId = randomUUID(), salesReader = randomUUID(), purchaseReader = randomUUID(), documentReader = randomUUID(), outsider = randomUUID();
const day = "2026-10-09", originalDay = "2026-10-01";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let org, accounts, customer, vendor, center, taxCode, stage = "connect", checks = 0;
const fixtures = {};
const query = (sql, args = []) => ownerPool.query(sql, args);
const report = check => { checks++; process.stdout.write(`${JSON.stringify({ check, status: "passed" })}\n`); };
async function asActor(userId, work, readOnly = false) {
  const client = await runtimePool.connect();
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SET LOCAL statement_timeout='25s'");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)", [userId]);
    const value = await work(client);
    await client.query(readOnly ? "ROLLBACK" : "COMMIT");
    return value;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function evidence() {
  return (await query(`SELECT jsonb_build_object(
    'documents',(SELECT jsonb_agg(jsonb_build_array(id,state,version,material_digest,document_number,total_amount::text,party_snapshot) ORDER BY id) FROM finance.business_documents WHERE organization_id=$1),
    'source_lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.document_lines l WHERE organization_id=$1),
    'numbers',(SELECT jsonb_agg(jsonb_build_array(document_type,next_value) ORDER BY document_type) FROM finance.document_sequences WHERE organization_id=$1),
    'journals',(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1),
    'lines',(SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1),
    'items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),
    'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),
    'unapplies',(SELECT count(*) FROM finance.allocation_reversals WHERE organization_id=$1),
    'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),
    'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),
    'requests',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1)
  ) AS value`, [org])).rows[0].value;
}
async function rejects(code, work, message) {
  const before = await evidence();
  await assert.rejects(work, error => error?.code === code && (!message || error.message === message));
  assert.deepEqual(await evidence(), before, "Denied command must roll back all source, accounting, sequence, audit, outbox and receipt effects.");
}
async function options(source = null, type = "customer_credit", date = day, actor = ownerId, party = null, organization = org) {
  const before = await evidence();
  const result = await asActor(actor, client => client.query("SELECT public.read_credit_note_options($1::uuid,$2::text,$3::date,$4::uuid,$5::uuid,NULL::text) AS value", [organization, type, date, party, source]), true);
  assert.deepEqual(await evidence(), before, "Source options are read-only.");
  return result.rows[0].value;
}
function line(type, quantity = "10.000000", price = "10.000000", extras = {}) {
  return { id: null, item_id: null, original_line_id: null, description: "Synthetic original service", quantity, unit_price: price,
    discount_amount: "0.00", account_id: accounts[type === "invoice" || type === "customer_credit" ? "4000" : "6000"],
    cost_center_id: center, tax_code_id: null, tax_mode: "exclusive", cash_flow_class: null, ...extras };
}
function sourcePayload(type = "invoice", extras = {}) {
  return { document_type: type, party_id: type === "invoice" || type === "customer_credit" ? customer : vendor,
    issue_date: originalDay, accounting_date: originalDay, due_date: null, description: "Synthetic credit verification", external_reference: run,
    currency: "BDT", rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null,
    trade: { recognition_mode: "earned_or_incurred", performance_confirmed: true, supplier_invoice_date: type === "bill" ? originalDay : null,
      supplier_invoice_key: type === "bill" ? randomUUID() : null }, movement: null, transfer: null,
    lines: [line(type)], journal_rows: [], allocation_plan: [], ...extras };
}
function creditPayload(source, quantity = "4.000000", extras = {}, lineExtras = {}) {
  const type = source.document_type === "invoice" ? "customer_credit" : "vendor_credit";
  const original = source.lines[0];
  return sourcePayload(type, { issue_date: day, accounting_date: day,
    trade: { recognition_mode: source.trade.recognition_mode, performance_confirmed: true, original_document_id: source.id },
    lines: [line(type, quantity, original.unit_price, { original_line_id: original.id, account_id: original.account_id,
      cost_center_id: original.cost_center_id, tax_code_id: original.tax_code_id, tax_mode: original.tax_mode, ...lineExtras })], ...extras });
}
async function save(payload, current = null) {
  const key = randomUUID();
  return (await asActor(ownerId, client => client.query("SELECT * FROM public.save_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::jsonb)",
    [org, current?.document_id ?? null, current?.document_version ?? null, `credit_${key}`, key, hash(payload), JSON.stringify(payload)]))).rows[0];
}
async function submit(document) {
  const key = randomUUID();
  const result = (await asActor(ownerId, client => client.query("SELECT * FROM public.submit_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::text)",
    [org, document.document_id, document.document_version, `documents.submit:${document.document_id}`, `credit_${key}`, key, hash(document)]))).rows[0];
  assert.equal(result.state, "approved");
  return result;
}
async function post(document, key = randomUUID()) {
  return (await asActor(ownerId, client => client.query("SELECT * FROM public.post_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text)",
    [org, document.document_id, document.document_version, `credit_${key}`, key, hash(document)]))).rows[0];
}
async function detail(id) {
  return (await asActor(ownerId, client => client.query("SELECT public.read_financial_document($1::uuid,$2::uuid) AS value", [org, id]), true)).rows[0].value;
}
async function issue(payload) {
  const saved = await save(payload), approved = await submit(saved);
  await post(approved);
  return detail(saved.document_id);
}
async function reverse(id, date) {
  const key = randomUUID(), reason = "Synthetic credit capacity reversal verification";
  return (await asActor(ownerId, client => client.query("SELECT * FROM public.reverse_posted_document($1::uuid,$2::uuid,$3::date,$4::text,$5::text,$6::text,$7::text)",
    [org, id, date, reason, `credit_${key}`, key, hash({ id, date, reason })]))).rows[0];
}
function remaining(value, quantity, amount) {
  assert.equal(value.selected_source.lines[0].remaining_quantity, quantity);
  assert.equal(value.selected_source.remaining_total_amount, amount);
}
async function assertBalanced(id, total, expected) {
  const data = await detail(id);
  assert.equal(data.state, "posted"); assert.equal(data.total_amount, total);
  const actual = data.posted_journal.lines.map(row => [row.account_code, row.debit, row.credit]).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(actual, expected.sort((a, b) => a[0].localeCompare(b[0])));
  const sum = (await query(`SELECT sum(l.debit)::text AS debit,sum(l.credit)::text AS credit FROM finance.journal_lines l
    JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE j.organization_id=$1 AND j.source_document_id=$2`, [org, id])).rows[0];
  assert.equal(sum.debit, total); assert.equal(sum.credit, total);
}
async function foreignOriginal() {
  const savedContext = { org, accounts, customer, center };
  try {
    const otherRun = randomUUID();
    org = (await asActor(ownerId, client => client.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$2)", [`Foreign credit QA ${otherRun}`, otherRun]))).rows[0].organization_id;
    await query("UPDATE finance.organizations SET status='active',updated_at=now() WHERE id=$1", [org]);
    accounts = Object.fromEntries((await query("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [org])).rows.map(row => [row.code, row.id]));
    customer = randomUUID(); center = randomUUID();
    await query("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Foreign synthetic customer',true,false)", [customer, org]);
    await query("INSERT INTO finance.cost_centers(id,organization_id,code,name) VALUES($1,$2,'FOREIGN','Foreign synthetic center')", [center, org]);
    const role = (await query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
    const key = randomUUID();
    await asActor(ownerId, client => client.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,'Foreign invoice','invoice','999999999.00',$5,1,false,true,$6)", [org, `credit_${key}`, key, hash(key), role, "Synthetic tenant-boundary verification policy"]));
    const source = await issue(sourcePayload());
    return { organizationId: org, partyId: customer, documentId: source.id, lineId: source.lines[0].id };
  } finally { ({ org, accounts, customer, center } = savedContext); }
}

try {
  const role = (await runtimePool.query(`SELECT current_user,session_user=current_user AS direct_login,NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AS restricted,
    pg_has_role(current_user,'ams_runtime','member') AS runtime_member,has_table_privilege(current_user,'finance.journal_lines','INSERT') AS direct_insert,
    has_function_privilege(current_user,'finance_private.credit_remaining_capacity(uuid,uuid,date,uuid)','EXECUTE') AS private_execute
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(role.current_user, "ams_app_login"); assert.ok(role.direct_login && role.restricted && role.runtime_member && !role.direct_insert && !role.private_execute);
  stage = "synthetic fixture setup";
  for (const [id, name] of [[ownerId, "Credit QA owner"], [salesReader, "Sales reader"], [purchaseReader, "Purchase reader"], [documentReader, "Document reader"], [outsider, "Unrelated reader"]]) {
    await query("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())", [id, `credit-${id}@example.invalid`, name, "$argon2id$synthetic-unusable-test-hash"]);
    await query("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')", [id, name]);
  }
  org = (await asActor(ownerId, client => client.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$2)", [`Credit source QA ${run}`, run]))).rows[0].organization_id;
  // This direct activation is synthetic fixture setup only; company onboarding is tested separately.
  await query("UPDATE finance.organizations SET status='active',updated_at=now() WHERE id=$1", [org]);
  accounts = Object.fromEntries((await query("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [org])).rows.map(row => [row.code, row.id]));
  const ownerRole = (await query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
  for (const [userId, name, permission] of [[salesReader, "Sales-only", "sales.read"], [purchaseReader, "Purchase-only", "purchases.read"], [documentReader, "Document-only", "documents.read"]]) {
    const member = randomUUID(), roleId = randomUUID();
    await query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)", [member, org, userId, name]);
    await query("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)", [roleId, org, name]);
    await query("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=$3", [org, roleId, permission]);
    await query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [org, member, roleId]);
  }
  customer = randomUUID(); vendor = randomUUID(); center = randomUUID(); taxCode = randomUUID();
  await query("INSERT INTO finance.contacts(id,organization_id,display_name,billing_address,tax_identifiers,is_customer,is_vendor) VALUES($1,$3,'Original credit customer',$4::jsonb,$5::jsonb,true,false),($2,$3,'Original credit supplier',$4::jsonb,$5::jsonb,false,true)",
    [customer, vendor, org, JSON.stringify({ line1: "Original issued address" }), JSON.stringify({ tin: "QA-ORIGINAL" })]);
  await query("INSERT INTO finance.cost_centers(id,organization_id,code,name) VALUES($1,$2,'CREDIT','Original credit center')", [center, org]);
  await query("INSERT INTO finance.tax_codes(id,organization_id,code,label,rate_percent,tax_kind,output_account_id,input_account_id,recoverability,effective_from,version_no) VALUES($1,$2,'QA5','Historic illustrative 5 percent',5,'standard',$3,$4,'full','2026-01-01',1)", [taxCode, org, accounts["2100"], accounts["1200"]]);
  for (const type of ["invoice", "bill", "customer_credit", "vendor_credit"]) {
    const key = randomUUID();
    await asActor(ownerId, client => client.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,$8)", [org, `credit_${key}`, key, hash(type), `Credit ${type}`, type, ownerRole, "Synthetic credit verification policy"]));
  }
  report("actual restricted login; unique synthetic organization and scoped read roles created");

  stage = "original source snapshots and read permissions";
  const invoice = await issue(sourcePayload("invoice", { lines: [line("invoice", "10.000000", "10.000000", { tax_code_id: taxCode })] }));
  const bill = await issue(sourcePayload("bill", { lines: [line("bill", "10.000000", "10.000000", { tax_code_id: taxCode })] }));
  fixtures.invoice = invoice.id; fixtures.bill = bill.id;
  const sales = await options(invoice.id, "customer_credit", day, salesReader, customer);
  const purchases = await options(bill.id, "vendor_credit", day, purchaseReader, vendor);
  assert.equal(sales.selected_source.lines[0].unit_price, "10.000000"); assert.equal(sales.selected_source.lines[0].tax_rate_snapshot, "5.000000");
  assert.equal(sales.selected_source.lines[0].account_code, "4000"); assert.equal(purchases.selected_source.lines[0].account_code, "6000");
  assert.equal(purchases.selected_source.supplier_reference, bill.trade.supplier_invoice_key);
  assert.ok(!("posted_journal" in sales.selected_source)); remaining(sales, "10.000000", "105.00");
  for (const actor of [purchaseReader, documentReader, outsider]) await rejects("42501", () => options(invoice.id, "customer_credit", day, actor));
  await rejects("42501", () => options(bill.id, "vendor_credit", day, salesReader));
  await rejects("42501", () => options(invoice.id, "customer_credit", day, ownerId, null, randomUUID()));
  await rejects("P0002", () => options(randomUUID()));
  await rejects("P0002", () => options(invoice.id, "customer_credit", day, ownerId, randomUUID()));
  await rejects("42501", () => asActor(ownerId, client => client.query("SELECT * FROM finance_private.credit_remaining_capacity($1,$2,$3,NULL)", [org, invoice.id, day])));
  report("module-only customer/supplier source reads preserve exact original fields; permission, company, party and private helper denials have no effects");

  stage = "two-company tenant boundaries";
  const foreign = await foreignOriginal();
  fixtures.foreignOrganization = foreign.organizationId;
  await rejects("P0002", () => options(foreign.documentId));
  await rejects("P0002", () => options(null, "customer_credit", day, ownerId, foreign.partyId));
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", { trade: { ...creditPayload(invoice).trade, original_document_id: foreign.documentId } })));
  await rejects("P0002", () => save(creditPayload(invoice, "1.000000", {}, { original_line_id: foreign.lineId })));
  assert.ok((await options()).sources.every(source => source.id !== foreign.documentId));
  report("actor belonging to two companies cannot select or mix the other company's actual posted source, party or original line");

  stage = "immutable source after contact and tax changes";
  const beforeOriginal = await detail(invoice.id);
  await query("UPDATE finance.contacts SET display_name='Changed live contact',billing_address=$3::jsonb,tax_identifiers=$4::jsonb,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [org, customer, JSON.stringify({ line1: "Changed address" }), JSON.stringify({ tin: "CHANGED" })]);
  await query("UPDATE finance.tax_codes SET effective_to='2026-10-01',is_active=false,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [org, taxCode]);
  const newTax = randomUUID();
  await query("INSERT INTO finance.tax_codes(id,organization_id,code,label,rate_percent,tax_kind,output_account_id,input_account_id,recoverability,effective_from,version_no) VALUES($1,$2,'QA5','Changed illustrative 9 percent',9,'standard',$3,$4,'full','2026-10-02',2)", [newTax, org, accounts["2100"], accounts["1200"]]);
  const preserved = await options(invoice.id);
  assert.deepEqual(preserved.selected_source.party_snapshot, beforeOriginal.party_snapshot); assert.equal(preserved.selected_source.party_name, "Original credit customer");
  assert.equal(preserved.selected_source.lines[0].tax_code_id, taxCode); assert.equal(preserved.selected_source.lines[0].tax_rate_snapshot, "5.000000"); assert.equal(preserved.selected_source.eligible, true);
  assert.deepEqual(await detail(invoice.id), beforeOriginal);
  report("contact edits and archived/replaced tax version leave original snapshot, source amount/version/digest and historical tax unchanged");

  stage = "partial credits and original snapshot posting";
  const credit = await issue(creditPayload(invoice, "4.000000", {}, { tax_code_id: newTax, tax_mode: "inclusive" }));
  assert.equal(credit.lines[0].tax_code_id, taxCode); assert.equal(credit.lines[0].tax_mode, "exclusive"); assert.equal(credit.lines[0].tax_rate_snapshot, "5.000000");
  await assertBalanced(credit.id, "42.00", [["1100", "0.00", "42.00"], ["4090", "40.00", "0.00"], ["2100", "2.00", "0.00"]]);
  const supplierCredit = await issue(creditPayload(bill));
  await assertBalanced(supplierCredit.id, "42.00", [["2000", "42.00", "0.00"], ["6000", "0.00", "40.00"], ["1200", "0.00", "2.00"]]);
  remaining(await options(invoice.id), "6.000000", "63.00"); remaining(await options(bill.id, "vendor_credit"), "6.000000", "63.00");
  fixtures.customerCredit = credit.id; fixtures.supplierCredit = supplierCredit.id;
  report("customer and supplier partial credits post complete balanced opposite journals using original tax and expense/revenue basis");

  stage = "drafts do not reserve; update excludes itself";
  const draftPayload = creditPayload(invoice, "5.000000");
  const draft = await save(draftPayload); await save(creditPayload(invoice, "5.000000"));
  const updated = await save(draftPayload, draft); await submit(updated);
  remaining(await options(invoice.id), "6.000000", "63.00");
  report("multiple drafts and approvals do not reserve capacity; editing an existing draft does not self-count");

  stage = "aggregate quantity, value, tax and inherited-account guards";
  await rejects("23514", () => save(creditPayload(invoice, "7.000000")), "credit lines exceed remaining original quantity or amount");
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", {}, { unit_price: "70.000000" })), "credit lines exceed remaining original quantity or amount");
  const duplicate = creditPayload(invoice, "4.000000"); duplicate.lines.push({ ...duplicate.lines[0] });
  await rejects("23514", () => save(duplicate), "credit lines exceed remaining original quantity or amount");
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", {}, { account_id: accounts["4090"] })), "credit lines must preserve the selected original accounting and tax snapshots");
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", {}, { cost_center_id: null })), "credit lines must preserve the selected original accounting and tax snapshots");
  await rejects("P0002", () => save(creditPayload(invoice, "1.000000", {}, { original_line_id: bill.lines[0].id })));
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", { party_id: vendor })));
  const taxSmall = await issue(sourcePayload("invoice", { issue_date: day, accounting_date: day, lines: [line("invoice", "10.000000", "0.100000", { tax_code_id: newTax })] }));
  await rejects("23514", () => save(creditPayload(invoice, "1.000000", {}, { original_line_id: taxSmall.lines[0].id })));
  const roundingLines = creditPayload(taxSmall, "1.000000"); roundingLines.lines = Array.from({ length: 10 }, () => ({ ...roundingLines.lines[0] }));
  await rejects("23514", () => save(roundingLines), "credit lines exceed remaining original quantity or amount");
  report("cumulative quantity/value, duplicate original lines, line-tax rounding, wrong parent/party and accounting-snapshot changes fail atomically");

  stage = "document rounding cap";
  const rounded = await issue(sourcePayload("invoice", { rounding_adjustment: "0.05", rounding_reason: "Synthetic rounding", rounding_account_id: accounts["6600"] }));
  await issue(creditPayload(rounded, "5.000000", { rounding_adjustment: "0.05", rounding_reason: "Synthetic rounding", rounding_account_id: accounts["6600"] }));
  await rejects("23514", () => save(creditPayload(rounded, "5.000000", { rounding_adjustment: "0.05", rounding_reason: "Synthetic rounding", rounding_account_id: accounts["6600"] })), "credit total including rounding exceeds remaining original total");
  remaining(await options(rounded.id), "5.000000", "50.00");
  report("header capacity includes rounding; two individually permitted positive adjustments cannot exceed original document total");

  stage = "original date, reversal and party eligibility";
  const future = await issue(sourcePayload("invoice", { issue_date: "2026-10-20", accounting_date: "2026-10-20" }));
  assert.equal((await options(future.id)).selected_source.eligible, false);
  await rejects("23514", () => save(creditPayload(future)), "credit original is reversed, future-dated, or incompatible");
  const reversedOriginal = await issue(sourcePayload()); await reverse(reversedOriginal.id, day);
  assert.equal((await options(reversedOriginal.id)).selected_source.eligible, false);
  await rejects("23514", () => save(creditPayload(reversedOriginal)), "credit original is reversed, future-dated, or incompatible");
  await assert.rejects(() => query("UPDATE finance.contacts SET is_customer=false,is_vendor=true,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [org, customer]), { code: "23514", message: "financial-history roles cannot be removed from a contact" });
  await query("UPDATE finance.contacts SET is_active=false,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [org, customer]);
  assert.match((await options(invoice.id)).selected_source.blocked_reason, /inactive/);
  await rejects("23514", () => save(creditPayload(invoice, "1.000000")));
  await query("UPDATE finance.contacts SET is_active=true,row_version=row_version+1 WHERE organization_id=$1 AND id=$2", [org, customer]);
  report("future-dated, reversed and inactive-party sources are unavailable; existing financial-history guard also prevents removing the original party role");

  stage = "dated credit reversals and future boundary capacity";
  const temporal = await issue(sourcePayload());
  const oldCredit = await issue(creditPayload(temporal, "6.000000", { issue_date: "2026-10-03", accounting_date: "2026-10-03" }));
  await reverse(oldCredit.id, "2026-10-05");
  remaining(await options(temporal.id, "customer_credit", "2026-10-04"), "4.000000", "40.00");
  remaining(await options(temporal.id, "customer_credit", "2026-10-05"), "10.000000", "100.00");
  await issue(creditPayload(temporal, "7.000000", { issue_date: "2026-10-10", accounting_date: "2026-10-10" }));
  remaining(await options(temporal.id, "customer_credit", "2026-10-02"), "3.000000", "30.00");
  await rejects("23514", () => save(creditPayload(temporal, "4.000000", { issue_date: "2026-10-04", accounting_date: "2026-10-04" })), "credit lines exceed remaining original quantity or amount");
  await issue(creditPayload(temporal, "3.000000", { issue_date: "2026-10-04", accounting_date: "2026-10-04" }));
  remaining(await options(temporal.id, "customer_credit", "2026-10-02"), "0.000000", "0.00");
  fixtures.temporalOriginal = temporal.id;
  report("credit reversal restores dated capacity; temporal peak protects future credits without double-counting non-overlapping reversed history");

  stage = "different-credit posting race and replay";
  const raceSource = await issue(sourcePayload());
  const a = await submit(await save(creditPayload(raceSource, "6.000000"))), b = await submit(await save(creditPayload(raceSource, "6.000000")));
  const keys = [randomUUID(), randomUUID()], requests = [a, b];
  const results = await Promise.allSettled(requests.map((request, index) => post(request, keys[index])));
  const winners = results.flatMap((result, index) => result.status === "fulfilled" ? [index] : []);
  assert.equal(winners.length, 1); const winner = winners[0], loser = 1 - winner;
  assert.equal(results[loser].reason.code, "23514"); assert.equal(results[loser].reason.message, "credit lines exceed remaining original quantity or amount");
  remaining(await options(raceSource.id), "4.000000", "40.00");
  const beforeReplay = await evidence();
  assert.deepEqual(await post(requests[winner], keys[winner]), results[winner].value); assert.deepEqual(await evidence(), beforeReplay);
  await rejects("23514", () => post(requests[loser]), "credit lines exceed remaining original quantity or amount");
  const state = (await query(`SELECT d.state,(SELECT count(*)::integer FROM finance.journal_entries j WHERE j.organization_id=d.organization_id AND j.source_document_id=d.id) AS journals,
    (SELECT count(*)::integer FROM finance.outbox_events o WHERE o.organization_id=d.organization_id AND o.document_id=d.id AND o.event_type='document.posted') AS post_events
    FROM finance.business_documents d WHERE d.organization_id=$1 AND d.id=$2`, [org, requests[loser].document_id])).rows[0];
  assert.deepEqual(state, { state: "approved", journals: 0, post_events: 0 });
  fixtures.raceOriginal = raceSource.id;
  report("two actual runtime connections race different approved credits; one posts, one retains approval with zero accounting/outbox effects; exact replay adds nothing");

  stage = "final immutable source and journal invariants";
  assert.deepEqual(await detail(invoice.id), beforeOriginal);
  const unbalanced = (await query(`SELECT count(*)::integer AS count FROM (SELECT j.id FROM finance.journal_entries j JOIN finance.journal_lines l ON l.organization_id=j.organization_id AND l.journal_entry_id=j.id
    WHERE j.organization_id=$1 AND j.state='posted' GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit)) q`, [org])).rows[0].count;
  assert.equal(unbalanced, 0);
  report("original issued source remains unchanged; every committed synthetic journal is balanced");
  process.stdout.write(`${JSON.stringify({ status: "passed", checks, run, organizationId: org, fixtures, fixtureSetup: "privileged unique synthetic identities/roles/master data; financial commands use actual restricted login", retained: true })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "failed", stage, checks, organizationId: org, code: error?.code, message: error?.message })}\n`);
  process.exitCode = 1;
} finally { await Promise.allSettled([ownerPool.end(), runtimePool.end()]); }
