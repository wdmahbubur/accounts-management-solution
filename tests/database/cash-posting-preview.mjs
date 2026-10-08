// Run only against an explicitly selected isolated database with migrations through 0087.
// TEST_DATABASE_URL is the fixture owner; TEST_DATABASE_RUNTIME_URL is the real restricted login.
// Each run owns a unique synthetic organization and retains it for browser/ledger evidence.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool, types } from "@neondatabase/serverless";

const ownerUrl = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL;
if (!ownerUrl || !runtimeUrl) throw new Error("Set TEST_DATABASE_URL and TEST_DATABASE_RUNTIME_URL for an isolated test database.");
const ownerTarget = new URL(ownerUrl), runtimeTarget = new URL(runtimeUrl);
if (ownerTarget.hostname !== runtimeTarget.hostname || ownerTarget.pathname !== runtimeTarget.pathname
  || decodeURIComponent(runtimeTarget.username) !== "ams_app_login") throw new Error("Test owner and restricted login must target the same isolated database.");
types.setTypeParser(types.builtins.DATE, value => value);
const ownerPool = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 30_000 });
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 2, connectionTimeoutMillis: 30_000 });
const run = randomUUID();
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ownerId = randomUUID(), writerId = randomUUID(), readerId = randomUUID(), reviewerId = randomUUID();
const date = "2026-10-08";
let organizationId, ownerMemberId, ownerRoleId, accounts, cashA, cashB, physicalCash, customerId, vendorId;
let checks = 0;
const report = (name, details = {}) => { checks++; process.stdout.write(`${JSON.stringify({ check: name, status: "passed", ...details })}\n`); };
async function ownerQuery(sql, args = []) { return ownerPool.query(sql, args); }
async function asActor(userId, work, readOnly = false) {
  const client = await runtimePool.connect();
  try {
    await client.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)", [userId]);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
async function expectSql(code, work) { await assert.rejects(work, error => error?.code === code); }
async function snapshot() {
  const result = await ownerQuery(`SELECT jsonb_build_object(
    'documents',(SELECT jsonb_agg(jsonb_build_array(d.id,d.version,d.state,d.document_number) ORDER BY d.id) FROM finance.business_documents d WHERE d.organization_id=$1),
    'sequences',(SELECT jsonb_agg(jsonb_build_array(s.document_type,s.next_value) ORDER BY s.document_type) FROM finance.document_sequences s WHERE s.organization_id=$1),
    'journals',(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1),
    'lines',(SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1),
    'open_items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),
    'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),
    'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),
    'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),
    'idempotency',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1)
  ) AS snapshot`, [organizationId]);
  return result.rows[0].snapshot;
}
function payload(type, amount, overrides = {}) {
  const trade = ["invoice", "bill"].includes(type);
  const transfer = type === "transfer";
  const incoming = ["receipt", "customer_refund", "customer_advance"].includes(type);
  return { document_type: type, party_id: transfer ? null : type === "invoice" || incoming ? customerId : vendorId,
    issue_date: date, accounting_date: date, due_date: null, description: `Cash preview QA ${type}`, external_reference: null,
    currency: "BDT", rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null,
    trade: trade ? { recognition_mode: "earned_or_incurred", performance_confirmed: true,
      supplier_invoice_date: type === "bill" ? date : null, supplier_invoice_key: type === "bill" ? randomUUID() : null } : null,
    movement: !trade && !transfer ? { cash_account_id: cashA, direction: ["receipt", "customer_advance", "vendor_refund"].includes(type) ? "in" : "out",
      amount, method: "bank_transfer", reference: "", cash_flow_class: "operating" } : null,
    transfer: transfer ? { from_cash_account_id: cashA, to_cash_account_id: cashB, amount, fee_amount: "0.00", fee_account_id: null } : null,
    lines: trade ? [{ id: null, item_id: null, original_line_id: null, description: "Synthetic service", quantity: "1.000000", unit_price: `${amount}0000`,
      discount_amount: "0.00", account_id: accounts[type === "invoice" ? "4000" : "6000"], cost_center_id: null, tax_code_id: null, tax_mode: "exclusive", cash_flow_class: null }] : [],
    journal_rows: [], allocation_plan: [], ...overrides };
}
async function save(source, userId = ownerId, current = null) {
  const key = randomUUID();
  const result = await asActor(userId, client => client.query(
    "SELECT * FROM public.save_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::jsonb)",
    [organizationId, current?.document_id ?? null, current?.document_version ?? null, `qa_${key}`, key, hash(source), JSON.stringify(source)]
  ));
  return result.rows[0];
}
async function submit(document, expectedState = "approved") {
  const key = randomUUID();
  const result = await asActor(ownerId, client => client.query(
    "SELECT * FROM public.submit_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::text)",
    [organizationId, document.document_id, document.document_version, `documents.submit:${document.document_id}`, `qa_${key}`, key, hash(document)]
  ));
  assert.equal(result.rows[0].state, expectedState);
  return result.rows[0];
}
async function saveAllocationPlan(document, plan) {
  const key = randomUUID();
  const result = await asActor(ownerId, client => client.query(
    "SELECT * FROM public.save_document_allocation_plan($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::jsonb)",
    [organizationId, document.document_id, document.document_version, `qa_${key}`, key, hash(plan), JSON.stringify(plan)]
  ));
  return result.rows[0];
}
async function preview(document, userId = ownerId) {
  const before = await snapshot();
  const result = await asActor(userId, client => client.query(
    "SELECT public.preview_cash_document_posting($1::uuid,$2::uuid,$3::integer) AS preview",
    [organizationId, document.document_id, document.document_version]
  ), true);
  assert.deepEqual(await snapshot(), before, "preview must not change any source, number, accounting, audit or outbox records");
  return result.rows[0].preview;
}
async function approvalPreview(approval, userId = reviewerId) {
  const before = await snapshot();
  const result = await asActor(userId, client => client.query(
    "SELECT public.preview_approval_cash_posting($1::uuid,$2::uuid,$3::integer) AS preview",
    [organizationId, approval.approval_request_id, approval.document_version]
  ), true);
  assert.deepEqual(await snapshot(), before);
  return result.rows[0].preview;
}
async function post(document, key = randomUUID()) {
  const result = await asActor(ownerId, client => client.query(
    "SELECT * FROM public.post_financial_document($1::uuid,$2::uuid,$3::integer,$4::text,$5::text,$6::text)",
    [organizationId, document.document_id, document.document_version, `qa_${key}`, key, hash(document)]
  ));
  return result.rows[0];
}
async function openItem(documentId) {
  const result = await ownerQuery(`SELECT oi.id FROM finance.open_items oi
    JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
    JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE j.organization_id=$1 AND j.source_document_id=$2`, [organizationId, documentId]);
  assert.equal(result.rowCount, 1);
  return result.rows[0].id;
}
async function assertPostedPlan(document, planned) {
  const result = await ownerQuery(`SELECT l.line_no,l.account_id,l.party_id,l.description,l.debit::text,l.credit::text,l.cash_flow_class::text
    FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE j.organization_id=$1 AND j.source_document_id=$2 AND j.state='posted' ORDER BY l.line_no`, [organizationId, document.document_id]);
  const normalize = row => ({ line_no: row.line_no, account_id: row.account_id, party_id: row.party_id,
    description: row.description, debit: row.debit, credit: row.credit, cash_flow_class: row.cash_flow_class });
  assert.deepEqual(result.rows.map(normalize), planned.lines.map(normalize));
  const control = await ownerQuery(`SELECT count(*)::integer AS count FROM finance.open_items oi
    JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
    JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE j.organization_id=$1 AND j.source_document_id=$2`, [organizationId, document.document_id]);
  assert.equal(control.rows[0].count, planned.document_type === "transfer" ? 0 : 1);
}

try {
  const role = await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_roles r WHERE r.rolname=current_user");
  assert.equal(role.rows[0].current_user, "ams_app_login");
  assert.equal(role.rows[0].rolsuper, false); assert.equal(role.rows[0].rolbypassrls, false); assert.equal(role.rows[0].rolcreaterole, false);
  for (const [id, name] of [[ownerId, "Owner"], [writerId, "Sales writer"], [readerId, "Sales reader"], [reviewerId, "Approval reader"]]) {
    await ownerQuery("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())",
      [id, `cash-preview-${id}@example.invalid`, name, "$argon2id$synthetic-unusable-test-hash"]);
    await ownerQuery("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')", [id, name]);
  }
  const company = await asActor(ownerId, client => client.query(
    "SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2026-01-01'::date,$2)", [`Cash preview QA ${run}`, run]
  ));
  ({ organization_id: organizationId, owner_member_id: ownerMemberId } = company.rows[0]);
  // Activation is fixture setup only. These tests intentionally do not depend on migration 0086.
  await ownerQuery("UPDATE finance.organizations SET status='active',updated_at=now() WHERE id=$1", [organizationId]);
  accounts = Object.fromEntries((await ownerQuery("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [organizationId])).rows.map(row => [row.code, row.id]));
  ownerRoleId = (await ownerQuery("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [organizationId])).rows[0].id;
  for (const [userId, name, permissions] of [[writerId, "Preview sales writer", ["sales.read", "sales.write", "dues.read"]],
    [readerId, "Preview sales reader", ["sales.read"]], [reviewerId, "Preview approval reader", ["approvals.read", "documents.read"]]]) {
    const memberId = randomUUID(), roleId = randomUUID();
    await ownerQuery("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)", [memberId, organizationId, userId, name]);
    await ownerQuery("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)", [roleId, organizationId, name]);
    await ownerQuery("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])", [organizationId, roleId, permissions]);
    await ownerQuery("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [organizationId, memberId, roleId]);
  }
  [cashA, cashB, physicalCash] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, name, kind, account] of [[cashA, "Preview bank A", "bank", accounts["1010"]], [cashB, "Preview bank B", "bank", accounts["1020"]], [physicalCash, "Preview physical cash", "cash", accounts["1000"]]]) {
    await ownerQuery("INSERT INTO finance.cash_accounts(id,organization_id,name,kind,account_id,is_cash_equivalent,allow_negative_balance) VALUES($1,$2,$3,$4,$5,true,false)", [id, organizationId, name, kind, account]);
  }
  customerId = randomUUID(); vendorId = randomUUID();
  await ownerQuery("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Preview customer',true,false),($3,$2,'Preview supplier',false,true)", [customerId, organizationId, vendorId]);
  for (const type of ["invoice", "bill", "receipt", "vendor_payment", "transfer", "customer_advance", "vendor_advance", "customer_refund", "vendor_refund"]) {
    const key = randomUUID();
    await asActor(ownerId, client => client.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,$8)",
      [organizationId, `qa_${key}`, key, hash(type), `Preview ${type}`, type, ownerRoleId, "Synthetic preview verification policy"]));
  }
  report("isolated fixture and actual restricted-login capability variants", { organization_id: organizationId });

  const invoice = await save(payload("invoice", "1000.00")); await submit(invoice); await post(invoice);
  const invoiceItem = await openItem(invoice.document_id);
  const bill = await save(payload("bill", "2000.00")); await submit(bill); await post(bill);
  const billItem = await openItem(bill.document_id);
  const unallocated = await save(payload("receipt", "1250.37"), writerId);
  const unallocatedPlan = await preview(unallocated, writerId);
  assert.equal(unallocatedPlan.debit, "1250.37"); assert.equal(unallocatedPlan.credit, "1250.37");
  assert.equal(unallocatedPlan.unallocated_amount, "1250.37"); assert.deepEqual(unallocatedPlan.allocations, []);
  report("unallocated receipt, exact scale, NULL due date and READ ONLY no-effects preview");

  let planDraft = await save(payload("receipt", "50.00"));
  const originalVersion = planDraft.document_version;
  planDraft = await saveAllocationPlan(planDraft, [{ target_open_item_id: invoiceItem, amount: "25.00" }]);
  assert.equal(planDraft.document_version, originalVersion + 1);
  assert.equal((await preview(planDraft)).allocated_amount, "25.00");
  planDraft = await saveAllocationPlan(planDraft, [{ target_open_item_id: invoiceItem, amount: "20.00" }]);
  assert.equal(planDraft.document_version, originalVersion + 2);
  assert.equal((await preview(planDraft)).allocated_amount, "20.00");
  for (const plan of [[{ target_open_item_id: invoiceItem }], [{ amount: "10.00" }],
    [{ target_open_item_id: invoiceItem, amount: "10.00", unexpected: true }], ["scalar"], [null], [[]],
    [{ target_open_item_id: invoiceItem, amount: 10 }]]) {
    const before = await snapshot();
    await expectSql("22023", () => saveAllocationPlan(planDraft, plan));
    assert.deepEqual(await snapshot(), before);
    await expectSql("22023", () => save(payload("receipt", "50.00", { allocation_plan: plan })));
    assert.deepEqual(await snapshot(), before);
  }
  report("separate allocation-plan save/update versions correctly; both save paths reject missing/extra/scalar/non-string rows without effects");

  const receipt = await save(payload("receipt", "1250.00", { allocation_plan: [{ target_open_item_id: invoiceItem, amount: "1000.00" }] }));
  const receiptPlan = await preview(receipt);
  assert.equal(receiptPlan.allocated_amount, "1000.00"); assert.equal(receiptPlan.unallocated_amount, "250.00");
  assert.equal(receiptPlan.lines[0].debit, "1250.00"); assert.equal(receiptPlan.lines[1].account_id, accounts["1100"]);
  const receiptApproval = await submit(receipt);
  assert.deepEqual(await approvalPreview(receiptApproval), receiptPlan);
  const receiptPostKey = randomUUID(); const postedReceipt = await post(receipt, receiptPostKey);
  await assertPostedPlan(receipt, receiptPlan);
  assert.deepEqual(await post(receipt, receiptPostKey), postedReceipt);
  await expectSql("23505", () => post(receipt));
  report("receipt preview equals committed journal, approvals need no write capability, excess stays AR credit, replay is stable");

  const payment = await save(payload("vendor_payment", "500.00", { allocation_plan: [{ target_open_item_id: billItem, amount: "500.00" }] }));
  const paymentPlan = await preview(payment); const paymentApproval = await submit(payment);
  assert.deepEqual(await approvalPreview(paymentApproval), paymentPlan);
  assert.equal(paymentPlan.lines[0].credit, "500.00"); assert.equal(paymentPlan.lines[1].account_id, accounts["2000"]);
  await post(payment); await assertPostedPlan(payment, paymentPlan);
  report("supplier payment preview equals committed AP-debit / bank-credit journal");

  for (const fee of ["0.00", "25.00"]) {
    const transfer = await save(payload("transfer", "125.37", { transfer: { from_cash_account_id: cashA, to_cash_account_id: cashB,
      amount: "125.37", fee_amount: fee, fee_account_id: fee === "0.00" ? null : accounts["6400"] } }));
    const planned = await preview(transfer); const approval = await submit(transfer);
    assert.equal(planned.debit, fee === "0.00" ? "125.37" : "150.37");
    assert.equal(planned.lines.length, fee === "0.00" ? 2 : 3);
    assert.deepEqual(await approvalPreview(approval), planned);
    await post(transfer); await assertPostedPlan(transfer, planned);
    report(`transfer preview equals committed principal/fee journal (${fee} fee)`);
  }
  for (const type of ["customer_advance", "vendor_advance", "customer_refund", "vendor_refund"]) {
    const document = await save(payload(type, "0.01")); const planned = await preview(document);
    await submit(document); await post(document); await assertPostedPlan(document, planned);
  }
  report("all four refund/advance branches preserve authoritative accounting at one-paisa precision");

  await expectSql("42501", () => preview(unallocated, readerId));
  await expectSql("42501", () => preview(unallocated, reviewerId));
  await expectSql("42501", () => approvalPreview(receiptApproval, writerId));
  await expectSql("42501", () => asActor(ownerId, client => client.query("SELECT * FROM finance_private.cash_document_posting_plan($1,$2)", [organizationId, unallocated.document_id]), true));
  await expectSql("P0002", () => asActor(ownerId, client => client.query("SELECT public.preview_cash_document_posting($1,$2,$3)", [randomUUID(), unallocated.document_id, unallocated.document_version]), true));
  await expectSql("P0002", () => asActor(reviewerId, client => client.query("SELECT public.preview_approval_cash_posting($1,$2,$3)", [organizationId, randomUUID(), 1]), true));
  await expectSql("40001", () => preview({ ...unallocated, document_version: unallocated.document_version + 1 }));
  await expectSql("40001", () => approvalPreview(receiptApproval));
  await expectSql("23514", () => preview(receipt));
  report("cross-company/private-planner/read-only capability, stale-version and posted-source denial");

  const broken = await save(payload("transfer", "10.00"));
  await ownerQuery("UPDATE finance.cash_accounts SET is_active=false WHERE organization_id=$1 AND id=$2", [organizationId, cashB]);
  await expectSql("23514", () => preview(broken));
  await ownerQuery("UPDATE finance.cash_accounts SET is_active=true WHERE organization_id=$1 AND id=$2", [organizationId, cashB]);
  await expectSql("23514", () => save(payload("transfer", "10.00", { transfer: { from_cash_account_id: cashA, to_cash_account_id: cashA, amount: "10.00", fee_amount: "0.00", fee_account_id: null } })));
  await expectSql("23514", () => save(payload("transfer", "10.00", { transfer: { from_cash_account_id: cashA, to_cash_account_id: cashB, amount: "10.00", fee_amount: "1.00", fee_account_id: null } })));
  report("archived cash account, equal transfer endpoints and missing fee account fail safely");

  const cashPayment = await save(payload("vendor_advance", "10000.00", { movement: { cash_account_id: physicalCash,
    direction: "out", amount: "10000.00", method: "cash", reference: "", cash_flow_class: "operating" } }));
  await preview(cashPayment); await submit(cashPayment);
  const beforeCashFailure = await snapshot();
  await expectSql("23514", () => post(cashPayment));
  assert.deepEqual(await snapshot(), beforeCashFailure);
  report("physical cash floor still rejects posting and rolls back every accounting/number/audit/outbox effect");

  // A saved target can lose capacity after approval. Preview and posting must both reject it.
  const remainingInvoice = await save(payload("invoice", "200.00")); await submit(remainingInvoice); await post(remainingInvoice);
  const target = await openItem(remainingInvoice.document_id);
  const pending = await save(payload("receipt", "200.00", { allocation_plan: [{ target_open_item_id: target, amount: "200.00" }] }));
  const pendingApproval = await submit(pending);
  const competing = await save(payload("receipt", "200.00", { allocation_plan: [{ target_open_item_id: target, amount: "200.00" }] }));
  await submit(competing); await post(competing);
  const beforeCapacityFailure = await snapshot();
  await expectSql("23P01", () => preview(pending));
  await expectSql("23P01", () => approvalPreview(pendingApproval));
  await expectSql("23P01", () => post(pending));
  assert.deepEqual(await snapshot(), beforeCapacityFailure);
  report("changed settlement capacity conflicts in draft/approval previews and atomic posting");

  const futureInvoice = await save(payload("invoice", "200.00")); await submit(futureInvoice); await post(futureInvoice);
  const futureTarget = await openItem(futureInvoice.document_id);
  const futureReceipt = await save(payload("receipt", "200.00", { issue_date: "2026-10-10", accounting_date: "2026-10-10",
    allocation_plan: [{ target_open_item_id: futureTarget, amount: "200.00" }] }));
  await submit(futureReceipt); await post(futureReceipt);
  const backdated = await save(payload("receipt", "100.00", { allocation_plan: [{ target_open_item_id: futureTarget, amount: "100.00" }] }));
  await expectSql("23P01", () => preview(backdated));
  report("backdated preview checks future allocation boundaries, not only residual on the accounting date");

  const recoveryInvoice = await save(payload("invoice", "88.00")); await submit(recoveryInvoice); await post(recoveryInvoice);
  const recoveryTarget = await openItem(recoveryInvoice.document_id);
  const recoveryDraft = await save(payload("receipt", "50.00", { allocation_plan: [{ target_open_item_id: recoveryTarget, amount: "25.00" }] }));
  assert.equal((await preview(recoveryDraft)).allocated_amount, "25.00");
  const recovered = await asActor(ownerId, client => client.query("SELECT * FROM public.read_receipt_allocation_options($1,$2,$3::date)", [organizationId, customerId, date]), true);
  assert.ok(recovered.rows.some(row => row.open_item_id === recoveryTarget));
  report("saved receipt target remains available to the edit-page recovery loader");

  const policyKey = randomUUID();
  await asActor(ownerId, client => client.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,'transfer','0.00',$6,1,false,true,$7)",
    [organizationId, `qa_${policyKey}`, policyKey, hash(policyKey), "Transfer review required", ownerRoleId, "Verify pending approval preview"]));
  const reviewSource = payload("transfer", "10.00");
  const reviewDocument = await save(reviewSource);
  const reviewPlan = await preview(reviewDocument);
  const requiredApproval = await submit(reviewDocument, "pending");
  assert.deepEqual(await approvalPreview(requiredApproval), reviewPlan);
  const beforeApprovalFailure = await snapshot();
  await expectSql("P0001", () => post(reviewDocument));
  assert.deepEqual(await snapshot(), beforeApprovalFailure);
  const edited = await save({ ...reviewSource, description: "Materially edited transfer" }, ownerId, reviewDocument);
  assert.equal(edited.document_version, reviewDocument.document_version + 1);
  await expectSql("40001", () => approvalPreview(requiredApproval));
  report("pending approval previews work without write capability; posting requires approval and material edits invalidate prior review");

  process.stdout.write(`${JSON.stringify({ result: "passed", checks, organization_id: organizationId, owner_user_id: ownerId, owner_member_id: ownerMemberId, source_invoice_id: invoice.document_id,
    saved_receipt_id: recoveryDraft.document_id, unallocated_receipt_id: unallocated.document_id, posted_receipt_id: receipt.document_id, note: "Synthetic fixture retained in explicitly selected isolated test database; no production or provider calls." })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ result: "failed", checks, organization_id: organizationId, code: error?.code, message: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
} finally { await Promise.allSettled([ownerPool.end(), runtimePool.end()]); }
