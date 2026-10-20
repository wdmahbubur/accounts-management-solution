import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, money, request } from "./helpers/accounting-fixture.mjs";

test("period locks, dated unapply, reopen and fiscal-year close preserve books", { timeout: 600_000 }, async t => {
  const f = await createAccountingFixture();
  const date = "2025-01-15";
  const rows = async sql => (await f.admin.query(sql, [f.org])).rows;
  const periods = () => rows("SELECT * FROM finance.accounting_periods WHERE organization_id=$1 AND kind='regular' ORDER BY starts_on");
  const invoke = async (name, period, user = f.ids.owner, reason = "Synthetic accounting acceptance rehearsal") =>
    (await f.rpc(`SELECT * FROM public.${name}($1,$2,$3,$4,$5)`, [f.org, period.id, period.row_version, request(name).id, reason], user)).rows[0];
  const yearAction = async (name, year, meta = request(name)) => (await f.rpc(`SELECT public.${name}($1,$2,$3,$4,$5,$6) AS value`, [f.org, year, meta.id, meta.key, meta.hash, "Synthetic annual close acceptance rehearsal"])).rows[0].value;
  let invoice, receipt, debit, credit, allocation, approved;
  try {
    await t.test("T-07 receipt allocated across three invoices preserves every residual", async () => {
      const docs = [];
      for (const amount of ["1000.00", "2000.00", "3000.00"]) docs.push(await f.posted(f.body("invoice", amount)));
      const items = await Promise.all(docs.map(doc => f.openItems(doc)));
      await f.posted(f.body("receipt", "3500.00", { allocation_plan: items.map((item, i) => ({ target_open_item_id: item[0].id, amount: ["500.00", "1000.00", "2000.00"][i] })) }));
      const aging = (await f.rpc("SELECT public.read_aging_snapshot($1,'ar',$2::date) AS value", [f.org, date], f.ids.owner, { readOnly: true })).rows[0].value.data;
      for (const [i, item] of items.entries()) money(aging.items.find(row => row.open_item_id === item[0].id || row.id === item[0].id)?.residual, ["500.00", "1000.00", "1000.00"][i]);
    });
    await t.test("T-26 prepare an allocation whose later reversal must retain historical aging", async () => {
      invoice = await f.posted(f.body("invoice", "1000.00"));
      debit = (await f.openItems(invoice))[0].id;
      receipt = await f.posted(f.body("receipt", "1000.00", { allocation_plan: [{ target_open_item_id: debit, amount: "500.00" }] }));
      credit = (await f.openItems(receipt))[0].id;
      allocation = (await f.admin.query("SELECT id AS allocation_id FROM finance.settlement_allocations WHERE organization_id=$1 AND debit_open_item_id=$2 AND credit_open_item_id=$3", [f.org, debit, credit])).rows[0];
      approved = await f.save(f.body("invoice", "50.00")); assert.equal((await f.submit(approved)).state, "approved");
    });
    await t.test("T-34 lock rejects posting, allocation, unapply and source reversal", async () => {
      const january = (await periods())[0]; await invoke("lock_accounting_period", january);
      await assert.rejects(() => f.post(approved), e => ["23514", "55P03"].includes(e.code));
      let m = request("locked allocation");
      await assert.rejects(() => f.rpc("SELECT * FROM public.allocate_open_items($1,$2,$3,$4,$5,$6,'100.00',$7::date)", [f.org, m.id, m.key, m.hash, debit, credit, date]), e => ["23514", "55P03"].includes(e.code));
      m = request("locked unapply");
      await assert.rejects(() => f.rpc("SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,$7::date,$8)", [f.org, allocation.allocation_id, `allocations.reverse:${allocation.allocation_id}`, m.id, m.key, m.hash, date, "Synthetic locked-period unapply"]), e => ["23514", "55P03"].includes(e.code));
      m = request("locked reversal");
      await assert.rejects(() => f.rpc("SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)", [f.org, invoice.document_id, date, "Synthetic locked-period reversal", m.id, m.key, m.hash]), e => ["23514", "55P03"].includes(e.code));
      assert.equal((await f.journal(approved)).length, 0);
    });
    await t.test("T-35 reopen checks capability, reason, recent auth and retains close evidence", async () => {
      let january = (await periods())[0];
      await assert.rejects(() => invoke("reopen_accounting_period", january, f.ids.billing), e => e.code === "42501");
      await assert.rejects(() => invoke("reopen_accounting_period", january, f.ids.owner, "short"), e => e.code === "22023");
      await f.admin.query("UPDATE identity.auth_sessions SET recent_auth_at=now()-interval '2 days' WHERE user_id=$1", [f.ids.owner]);
      await assert.rejects(() => invoke("reopen_accounting_period", january), e => e.code === "28000" || e.code === "42501");
      await f.admin.query("UPDATE identity.auth_sessions SET recent_auth_at=now() WHERE user_id=$1", [f.ids.owner]);
      const lock = (await rows("SELECT * FROM finance.period_events WHERE organization_id=$1 AND action='lock'"))[0];
      assert.ok(lock.checklist_snapshot); await invoke("reopen_accounting_period", january);
      assert.deepEqual((await rows("SELECT * FROM finance.period_events WHERE organization_id=$1 AND action='lock'"))[0], lock);
      assert.equal((await rows("SELECT * FROM finance.period_events WHERE organization_id=$1 AND action='reopen'")).length, 1);
      await f.post(approved);
      const m = request("dated unapply");
      await f.rpc("SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,'2025-02-01'::date,$7)", [f.org, allocation.allocation_id, `allocations.reverse:${allocation.allocation_id}`, m.id, m.key, m.hash, "Synthetic later-dated unapply"]);
      for (const [asOf, expected] of [["2025-01-31", "500.00"], ["2025-02-01", "1000.00"]]) {
        const data = (await f.rpc("SELECT public.read_aging_snapshot($1,'ar',$2::date) AS value", [f.org, asOf], f.ids.owner, { readOnly: true })).rows[0].value.data;
        money(data.items.find(row => row.open_item_id === debit || row.id === debit)?.residual, expected);
      }
    });
    await t.test("T-40 close transfers profit once and keeps historical P&L", async () => {
      const year = (await periods())[0].fiscal_year_id;
      const readPl = async () => (await f.rpc("SELECT public.read_profit_loss_snapshot($1,'2025-01-01'::date,'2025-12-31'::date,NULL,NULL,NULL) AS value", [f.org], f.ids.owner, { readOnly: true })).rows[0].value.data.totals.net_profit;
      const profit = await readPl();
      for (const period of await periods()) await invoke("lock_accounting_period", period);
      const m = request("close"), result = await yearAction("close_fiscal_year", year, m);
      assert.equal(result.status, "closed"); money(result.profit, profit);
      assert.deepEqual(await yearAction("close_fiscal_year", year, m), result);
      money(await readPl(), profit);
      const bs = (await f.rpc("SELECT public.read_balance_sheet_snapshot($1,'2025-12-31'::date,NULL) AS value", [f.org], f.ids.owner, { readOnly: true })).rows[0].value.data.current;
      money(bs.untransferred_earnings, "0.00"); money(bs.difference, "0.00");
      f.lastYearClose = { year, result, profit, snapshot: (await rows("SELECT report_snapshot FROM finance.year_close_runs WHERE organization_id=$1"))[0].report_snapshot };
    });
    await t.test("T-41 reopen and reclose preserve old run and one active transfer", async () => {
      const { year, result, profit, snapshot } = f.lastYearClose;
      const reopened = await yearAction("reopen_fiscal_year", year); assert.equal(reopened.status, "reopened");
      assert.deepEqual((await rows("SELECT report_snapshot FROM finance.year_close_runs WHERE organization_id=$1"))[0].report_snapshot, snapshot);
      for (const period of await periods()) await invoke("lock_accounting_period", period);
      const reclosed = await yearAction("close_fiscal_year", year); assert.notEqual(reclosed.run_id, result.run_id); money(reclosed.profit, profit);
      const runs = await rows("SELECT * FROM finance.year_close_runs WHERE organization_id=$1"); assert.equal(runs.length, 2); assert.equal(runs.filter(row => !row.reopen_document_id).length, 1);
      const bs = (await f.rpc("SELECT public.read_balance_sheet_snapshot($1,'2025-12-31'::date,NULL) AS value", [f.org], f.ids.owner, { readOnly: true })).rows[0].value.data.current;
      money(bs.untransferred_earnings, "0.00"); money(bs.difference, "0.00");
    });
    console.log(JSON.stringify({ fixture: "period-year-controls", organizationId: f.org }));
  } finally { await f.close(); }
});
