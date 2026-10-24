import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, money, request, units } from "./helpers/accounting-fixture.mjs";

test("golden books reconcile invoice, collection, purchases, paid expense and statements", { timeout: 600_000 }, async t => {
  const f = await createAccountingFixture();
  let invoice, bill, receipt, payment, expense;
  const read = (sql, args = [], user = f.ids.owner) => f.rpc(sql, args, user, { readOnly: true });
  const balance = async code => (await f.admin.query(`SELECT coalesce(sum(l.debit-l.credit),0)::text AS balance FROM finance.journal_lines l
    JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    WHERE j.organization_id=$1 AND j.state='posted' AND a.code=$2`, [f.org, code])).rows[0].balance;
  try {
    await t.test("T-01 drafts have no ledger effect; capital contributes cash without revenue", async () => {
      invoice = await f.save(f.body("invoice", "10000.00")); bill = await f.save(f.body("bill", "4000.00"));
      assert.equal((await f.journal(invoice)).length, 0); assert.equal((await f.journal(bill)).length, 0);
      money(await balance("4000"), "0.00");
      await f.posted(f.body("manual_journal", "100000.00", { journal_rows: [
        { account_id: f.accounts["1010"], debit: "100000.00", credit: "0.00", cash_flow_class: "financing", description: "Synthetic owner contribution" },
        { account_id: f.accounts["3000"], debit: "0.00", credit: "100000.00", description: "Synthetic capital" }
      ] }));
      money(await balance("1010"), "100000.00"); money(await balance("4000"), "0.00");
    });
    await t.test("T-02..T-05 an invoice posts once under same-key and different-key retries", async () => {
      assert.equal((await f.submit(invoice)).state, "approved");
      const meta = request(invoice), posted = await f.post(invoice, meta);
      assert.deepEqual(await f.post(invoice, meta), posted);
      // T-05 permits the existing result or a controlled conflict under a different key.
      let retry;
      try { retry = await f.post(invoice); } catch (error) { assert.equal(error.code, "23505"); }
      if (retry) assert.equal(retry.document_id, posted.document_id);
      await assert.rejects(() => f.post(invoice, { ...meta, hash: "a".repeat(64) }), error => error.code === "23505");
      const rows = await f.journal(invoice);
      assert.equal(new Set(rows.map(row => row.journal_id)).size, 1);
      money(rows.find(row => row.code === "1100").debit, "10000.00");
      money(rows.find(row => row.code === "4000").credit, "10000.00");
      assert.equal((await f.openItems(invoice)).length, 1);
    });
    await t.test("T-06 a partial collection leaves AR 4000 and does not recognize revenue twice", async () => {
      const item = (await f.openItems(invoice))[0].id;
      receipt = await f.posted(f.body("receipt", "6000.00", { issue_date: "2025-01-16", accounting_date: "2025-01-16", allocation_plan: [{ target_open_item_id: item, amount: "6000.00" }] }));
      money(await balance("1100"), "4000.00"); money(await balance("4000"), "-10000.00");
      money(await balance("1010"), "106000.00");
    });
    await t.test("T-14 a vendor payment reduces AP without a second expense", async () => {
      assert.equal((await f.submit(bill)).state, "approved"); await f.post(bill);
      const item = (await f.openItems(bill))[0].id;
      payment = await f.posted(f.body("vendor_payment", "3000.00", { issue_date: "2025-01-17", accounting_date: "2025-01-17", allocation_plan: [{ target_open_item_id: item, amount: "3000.00" }] }));
      money(await balance("2000"), "-1000.00"); money(await balance("6000"), "4000.00");
      money(await balance("1010"), "103000.00");
    });
    await t.test("paid rent recognizes one expense and cash movement", async () => {
      expense = await f.posted(f.body("paid_expense", "1000.00", { issue_date: "2025-01-18", accounting_date: "2025-01-18" }));
      money(await balance("6000"), "5000.00"); money(await balance("1010"), "102000.00");
    });
    await t.test("T-26 historical AR/AP aging follows settlement dates and reconciles control accounts", async () => {
      for (const [side, date, expected] of [["ar", "2025-01-15", "10000.00"], ["ar", "2025-01-16", "4000.00"], ["ap", "2025-01-16", "4000.00"], ["ap", "2025-01-17", "1000.00"]]) {
        const data = (await read("SELECT public.read_aging_snapshot($1,$2,$3::date) AS value", [f.org, side, date])).rows[0].value.data;
        money(data.net_trade_control_items, expected);
        money(data.trade_control_ledger, expected);
        money(data.net_bridge_difference, "0.00");
      }
    });
    await t.test("T-47 GL, trial balance, profit/loss, balance sheet and cash flow tie to golden books", async () => {
      const register=(await read("SELECT * FROM public.read_journal_register($1,NULL,'2025-01-01','2025-12-31',101)",[f.org])).rows;
      assert.equal(register.length,6);assert.equal(new Set(register.map(row=>row.document_type)).size,6);
      for(const row of register)money(row.debit_total,row.credit_total);
      const pl = (await read("SELECT public.read_profit_loss_snapshot($1,'2025-01-01'::date,'2025-12-31'::date,NULL,NULL,NULL) AS value", [f.org])).rows[0].value;
      money(pl.data.totals.net_profit, "5000.00");
      const bs = (await read("SELECT public.read_balance_sheet_snapshot($1,'2025-12-31'::date,NULL) AS value", [f.org])).rows[0].value.data.current;
      money(bs.assets, "106000.00"); money(bs.liabilities, "1000.00"); money(bs.equity_accounts, "100000.00");
      money(bs.untransferred_earnings, "5000.00"); money(bs.difference, "0.00");
      const trial = (await read("SELECT * FROM public.read_trial_balance($1,'2025-12-31'::date,NULL)", [f.org])).rows;
      assert.equal(trial.reduce((sum, row) => sum + units(row.closing_debit) - units(row.closing_credit), 0n), 0n);
      const ledger = (await read("SELECT * FROM public.read_general_ledger($1,$2,'2025-01-01'::date,'2025-12-31'::date,NULL,NULL,NULL,NULL,NULL,501)", [f.org, f.accounts["1010"]])).rows;
      assert.equal(ledger.length, 4);
      assert.equal(ledger.reduce((sum, row) => sum + units(row.debit) - units(row.credit), 0n), 10200000n);
      const cashbook = (await read("SELECT public.read_cash_account_ledger($1,$2,'2025-01-01'::date,'2025-12-31'::date,500) AS value", [f.org, f.cash])).rows[0].value;
      money(cashbook.opening_balance, "0.00"); money(cashbook.closing_balance, "102000.00");
      assert.equal(cashbook.transactions.length, 4);
      for (const [scope, party, expected] of [["customer", f.contacts.customer, "4000.00"], ["vendor", f.contacts.vendor, "1000.00"]]) {
        const statement = (await read("SELECT public.read_party_statement_snapshot($1,$2,$3,'2025-01-01'::date,'2025-12-31'::date) AS value", [f.org, scope, party])).rows[0].value.data;
        money(statement.closing.trade, expected); money(statement.control_bridge.trade_difference, "0.00");
        const allocation=statement.events.find(event=>event.event_type==='allocation');
        assert.equal(allocation.source_document_id,scope==='customer'?receipt.document_id:payment.document_id);
        assert.equal(allocation.related_document_id,scope==='customer'?invoice.document_id:bill.document_id);
      }
      const cash = (await read("SELECT public.read_cash_flow_snapshot($1,'2025-01-01'::date,'2025-12-31'::date) AS value", [f.org])).rows[0].value.data;
      money(cash.closing_cash, "102000.00");
      money(cash.reconciliation_difference, "0.00");
      for (const doc of [invoice, receipt, bill, payment, expense]) {
        const rows = await f.journal(doc);
        assert.equal(rows.reduce((sum, row) => sum + units(row.debit) - units(row.credit), 0n), 0n);
      }
    });
    await t.test('statement unapply evidence retains both distinct source documents without another journal',async()=>{
      const allocation=(await f.admin.query('SELECT id FROM finance.settlement_allocations WHERE organization_id=$1 AND source_document_id=$2',[f.org,receipt.document_id])).rows[0].id;
      const m=request('statement unapply');await f.rpc("SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,'2025-01-20'::date,$7)",[f.org,allocation,`allocations.reverse:${allocation}`,m.id,m.key,m.hash,'Synthetic statement counterpart check']);
      const statement=(await read("SELECT public.read_party_statement_snapshot($1,'customer',$2,'2025-01-01','2025-01-31') AS value",[f.org,f.contacts.customer])).rows[0].value.data;
      const event=statement.events.find(event=>event.event_type==='allocation_reversal');assert.equal(event.source_document_id,receipt.document_id);assert.equal(event.related_document_id,invoice.document_id);
      money(statement.closing.trade,'4000.00');money(await balance('1010'),'102000.00');
    });
    await t.test("S-03 reports deny Billing and foreign identities while Auditor succeeds", async () => {
      const sql = "SELECT public.read_balance_sheet_snapshot($1,'2025-12-31'::date,NULL) AS value";
      const restricted = [
        [sql, [f.org]],
        ["SELECT public.read_profit_loss_snapshot($1,'2025-01-01'::date,'2025-12-31'::date,NULL,NULL,NULL)", [f.org]],
        ["SELECT public.read_aging_snapshot($1,'ap','2025-12-31'::date)", [f.org]],
        ["SELECT public.read_cash_account_ledger($1,$2,'2025-01-01'::date,'2025-12-31'::date,500)", [f.org, f.cash]],
        ["SELECT public.read_party_statement_snapshot($1,'vendor',$2,'2025-01-01'::date,'2025-12-31'::date)", [f.org, f.contacts.vendor]]
      ];
      for (const user of [f.ids.billing, f.ids.outsider]) for (const [statement, args] of restricted) await assert.rejects(() => read(statement, args, user), error => error.code === "42501");
      money((await read(sql, [f.org], f.ids.auditor)).rows[0].value.data.current.assets, "106000.00");
    });
    console.log(JSON.stringify({ fixture: "golden-books", organizationId: f.org, invoice: invoice.document_id }));
  } finally { await f.close(); }
});
