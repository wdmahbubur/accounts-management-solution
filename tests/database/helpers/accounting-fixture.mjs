import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { neonConfig, Pool, types } from "@neondatabase/serverless";
import "../../../scripts/load-local-env.mjs";
import { assertIsolatedTargets, assertRestrictedRuntime } from "./isolation.mjs";

export const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const request = value => ({ id: `acceptance-${randomUUID()}`, key: randomUUID(), hash: hash(value) });
export function units(value) {
  assert.match(value, /^-?(0|[1-9]\d*)(?:\.\d{1,2})?$/);
  const [whole, decimal = ""] = value.replace(/^-/, "").split(".");
  return (BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"))) * (value.startsWith("-") ? -1n : 1n);
}
export const money = (actual, expected) => assert.equal(units(actual), units(expected));

export async function createAccountingFixture({ booksStart = "2025-01-01", date = "2025-01-15" } = {}) {
  const ownerUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const runtimeUrl = process.env.TEST_DATABASE_RUNTIME_URL ?? process.env.DATABASE_RUNTIME_URL;
  assertIsolatedTargets(ownerUrl, runtimeUrl);
  neonConfig.webSocketConstructor = WebSocket;
  types.setTypeParser(types.builtins.DATE, value => value);
  const admin = new Pool({ connectionString: ownerUrl, max: 1, connectionTimeoutMillis: 20_000 });
  const runtime = new Pool({ connectionString: runtimeUrl, max: 5, connectionTimeoutMillis: 20_000 });
  const ids = Object.fromEntries(["owner", "checker", "billing", "auditor", "outsider"].map(key => [key, randomUUID()]));
  async function asActor(user, work, { readOnly = false, rollback = false } = {}) {
    const db = await runtime.connect();
    try {
      await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      await db.query("SET LOCAL statement_timeout='30s'");
      await db.query("SET LOCAL lock_timeout='15s'");
      await db.query("SELECT set_config('ams.actor_user_id',$1,true)", [user]);
      const value = await work(db);
      await db.query(readOnly || rollback ? "ROLLBACK" : "COMMIT"); return value;
    } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { db.release(); }
  }
  const rpc = (sql, args = [], user = ids.owner, options = {}) => asActor(user, db => db.query(sql, args), options);
  const close = async () => { await runtime.end(); await admin.end(); };
  try {
    await assertRestrictedRuntime(runtime, runtimeUrl);
    for (const [name, id] of Object.entries(ids)) {
      await admin.query("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,'$argon2id$non-login-fixture',now())", [id, `acceptance-${id}@example.invalid`, `Synthetic ${name}`]);
      await admin.query("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')", [id, `Synthetic ${name}`]);
      await admin.query("INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at) VALUES($1,$2,0,now(),now()+interval '1 hour')", [randomUUID(), id]);
    }
    const org = (await rpc("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)", [`Acceptance ${randomUUID()}`, booksStart, randomUUID()])).rows[0].organization_id;
    const setup = request("zero setup");
    await rpc("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)", [org, setup.id, setup.key, setup.hash]);
    const accounts = Object.fromEntries((await admin.query("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [org])).rows.map(row => [row.code, row.id]));
    const ownerRole = (await admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
    for (const [name, template] of [["checker", "owner"], ["billing", "billing"], ["auditor", "auditor"]]) {
      const member = randomUUID();
      const role = template === "owner" ? ownerRole : (await admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key=$2", [org, template])).rows[0].id;
      await admin.query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)", [member, org, ids[name], `Synthetic ${name}`]);
      await admin.query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [org, member, role]);
    }
    const contacts = Object.fromEntries(["customer", "vendor", "dual"].map(key => [key, randomUUID()]));
    for (const [name, id] of Object.entries(contacts)) await admin.query("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,$3,$4,$5)", [id, org, `Synthetic ${name}`, name !== "vendor", name !== "customer"]);
    const cash = (await rpc("SELECT public.save_cash_account($1,'Synthetic acceptance bank','bank',$2,NULL,NULL,true,false) AS id", [org, accounts["1010"]])).rows[0].id;
    const policies = {};
    for (const type of ["manual_journal", "invoice", "bill", "receipt", "vendor_payment", "paid_expense"]) {
      const meta = request(type);
      policies[type] = (await rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,'Synthetic below-threshold acceptance policy')", [org, meta.id, meta.key, meta.hash, `Acceptance ${type}`, type, ownerRole])).rows[0];
    }
    async function save(body, current = null, user = ids.owner, meta = request(body)) {
      return (await rpc("SELECT * FROM public.save_financial_document($1,$2,$3,$4,$5,$6,$7::jsonb)", [org, current?.document_id ?? null, current?.document_version ?? null, meta.id, meta.key, meta.hash, JSON.stringify(body)], user)).rows[0];
    }
    async function submit(doc, user = ids.owner) {
      const meta = request(doc);
      return (await rpc("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)", [org, doc.document_id, doc.document_version, `documents.submit:${doc.document_id}`, meta.id, meta.key, meta.hash], user)).rows[0];
    }
    async function post(doc, meta = request(doc), user = ids.owner) {
      return (await rpc("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)", [org, doc.document_id, doc.document_version, meta.id, meta.key, meta.hash], user)).rows[0];
    }
    async function posted(body) { const doc = await save(body); assert.equal((await submit(doc)).state, "approved"); await post(doc); return doc; }
    const openItems = async doc => (await admin.query(`SELECT oi.id FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
      JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id WHERE j.organization_id=$1 AND j.source_document_id=$2 ORDER BY oi.id`, [org, doc.document_id])).rows;
    const journal = async doc => (await admin.query(`SELECT l.id,l.account_id,a.code,l.debit::text,l.credit::text,l.cash_flow_class::text,j.id AS journal_id FROM finance.journal_lines l
      JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
      WHERE j.organization_id=$1 AND j.source_document_id=$2 AND j.state='posted' ORDER BY l.line_no`, [org, doc.document_id])).rows;
    const line = (amount, account = accounts["4000"]) => ({ id: null, item_id: null, original_line_id: null, description: "Synthetic service", quantity: "1.000000", unit_price: `${amount}0000`, discount_amount: "0.00", account_id: account, cost_center_id: null, tax_code_id: null, tax_mode: "exclusive", cash_flow_class: null });
    function body(type, amount, overrides = {}) {
      const trade = ["invoice", "bill"].includes(type), incoming = type === "receipt";
      return { document_type: type, party_id: type === "manual_journal" ? null : type === "invoice" || incoming ? contacts.customer : contacts.vendor,
        issue_date: date, accounting_date: date, due_date: trade ? date : null, description: `Synthetic acceptance ${type}`, external_reference: null, currency: "BDT",
        rounding_adjustment: "0.00", rounding_reason: null, rounding_account_id: null,
        trade: trade ? { recognition_mode: "earned_or_incurred", performance_confirmed: true, supplier_invoice_date: type === "bill" ? date : null, supplier_invoice_key: type === "bill" ? randomUUID() : null } : null,
        movement: ["receipt", "vendor_payment", "paid_expense"].includes(type) ? { cash_account_id: cash, direction: incoming ? "in" : "out", amount, method: "bank_transfer", reference: "Synthetic acceptance", cash_flow_class: "operating" } : null,
        transfer: null, lines: trade || type === "paid_expense" ? [line(amount, accounts[type === "invoice" ? "4000" : "6000"])] : [], journal_rows: [], allocation_plan: [], ...overrides };
    }
    return { admin, runtime, ids, org, accounts, ownerRole, policies, contacts, cash, date, rpc, asActor, save, submit, post, posted, openItems, journal, line, body, close };
  } catch (error) { await close(); throw error; }
}
