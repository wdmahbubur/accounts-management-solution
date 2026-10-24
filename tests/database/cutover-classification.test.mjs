import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, money, request } from "./helpers/accounting-fixture.mjs";

test("opening AR/AP cutover, YTD summary and unclassified cash reporting", { timeout: 300_000 }, async t => {
  const f = await createAccountingFixture();
  let org, accounts, opening;
  const call = async (sql, args) => (await f.rpc(sql, args)).rows[0];
  try {
    await t.test("T-38 activate a balanced AR/AP opening with detailed parties and zero suspense", async () => {
      org = (await call("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2025-04-01'::date,$2)", [`Synthetic cutover ${randomUUID()}`, randomUUID()])).organization_id;
      accounts = Object.fromEntries((await f.admin.query("SELECT code,id FROM finance.accounts WHERE organization_id=$1", [org])).rows.map(row => [row.code, row.id]));
      const customer = randomUUID(), vendor = randomUUID();
      for (const [id, isCustomer] of [[customer, true], [vendor, false]]) await f.admin.query("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Synthetic opening party',$3,$4)", [id, org, isCustomer, !isCustomer]);
      const balances = [["1010", "40000.00", "0.00"], ["1100", "10000.00", "0.00"], ["2000", "0.00", "6000.00"], ["3000", "0.00", "29000.00"], ["4000", "0.00", "20000.00"], ["6000", "5000.00", "0.00"]];
      const journal = balances.map(([code, debit, credit]) => ({ account_id: accounts[code], party_id: code === "1100" ? customer : code === "2000" ? vendor : null, debit, credit, description: "Synthetic pre-cutover trial balance", cash_flow_class: null, open_item_reference: ["1100", "2000"].includes(code) ? `PRIOR-${code}` : null, open_item_due_date: ["1100", "2000"].includes(code) ? "2025-04-15" : null }));
      const prior = journal.map(({ account_id, debit, credit }) => ({ account_id, debit, credit }));
      const ytd = prior.filter(row => [accounts["4000"], accounts["6000"]].includes(row.account_id));
      const body = f.body("opening_balance", "55000.00", { party_id: null, issue_date: "2025-03-31", accounting_date: "2025-03-31", due_date: null, journal_rows: journal, lines: [], movement: null });
      const m = request(body);
      opening = (await call("SELECT public.save_opening_cutover_draft($1,NULL,NULL,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) AS value", [org, m.id, m.key, m.hash, JSON.stringify(body), JSON.stringify(prior), JSON.stringify(ytd), "Synthetic prior trial balance and party detail"])).value;
      const ownerRole = (await f.admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'", [org])).rows[0].id;
      const policy = request("sole operator opening");
      await call("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,'Synthetic explicit sole-operator opening','opening_balance','0.00',$5,1,true,true,$6)", [org, policy.id, policy.key, policy.hash, ownerRole, "Synthetic sole-operator exception is explicitly enabled"]);
      const submit = request(opening), approval = await call("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)", [org, opening.document_id, opening.document_version, `documents.submit:${opening.document_id}`, submit.id, submit.key, submit.hash]);
      const decision = request(approval); await call("SELECT * FROM public.decide_financial_approval($1,$2,$3,$4,$5,$6,'approve',NULL)", [org, approval.approval_request_id, `approvals.decide:${approval.approval_request_id}`, decision.id, decision.key, decision.hash]);
      const setup = request("cutover activation");
      const result = (await call("SELECT public.complete_company_setup($1,$2,$3,$4,'import_opening',false,$5,$6) AS value", [org, setup.id, setup.key, setup.hash, opening.document_id, opening.document_version])).value;
      assert.equal(result.opening_mode, "import_opening");
      for (const [side, expected] of [["ar", "10000.00"], ["ap", "6000.00"]]) {
        const data = (await call("SELECT public.read_aging_snapshot($1,$2,'2025-04-01'::date) AS value", [org, side])).value.data;
        money(data.net_trade_control_items, expected); money(data.trade_control_ledger, expected); money(data.net_bridge_difference, "0.00");
      }
      assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.journal_entries WHERE organization_id=$1 AND is_opening AND state='posted'", [org])).rows[0].n, 1);
      const suspense = (await f.admin.query("SELECT coalesce(sum(l.debit-l.credit),0)::text AS amount FROM finance.account_mappings m LEFT JOIN finance.journal_lines l ON l.organization_id=m.organization_id AND l.account_id=m.account_id WHERE m.organization_id=$1 AND m.mapping_key='opening_suspense'", [org])).rows[0].amount; money(suspense, "0.00");
    });
    await t.test("T-39 annual P&L includes imported YTD once with visible summary provenance", async () => {
      const annual = (await call("SELECT public.read_profit_loss_snapshot($1,'2025-01-01'::date,'2025-12-31'::date,NULL,NULL,NULL) AS value", [org])).value.data;
      money(annual.totals.net_profit, "15000.00"); assert.equal(annual.periods.current.ytd_summary_included, true);
      assert.ok(annual.accounts.some(row => row.current_evidence_document_id === opening.document_id && row.current_evidence_reference === "Synthetic prior trial balance and party detail"));
      for (const row of annual.accounts) { money(row.current_ledger_debit, "0.00"); money(row.current_ledger_credit, "0.00"); }
      const after = (await call("SELECT public.read_profit_loss_snapshot($1,'2025-04-01'::date,'2025-12-31'::date,NULL,NULL,NULL) AS value", [org])).value.data;
      money(after.totals.net_profit, "0.00"); assert.equal(after.periods.current.ytd_summary_included, false);
    });
    await t.test("T-42 unclassified cash is provisional and prevents period locking", async () => {
      await f.posted(f.body("manual_journal", "100.00", { journal_rows: [
        { account_id: f.accounts["1010"], debit: "100.00", credit: "0.00", cash_flow_class: "unclassified", description: "Synthetic unresolved cash classification" },
        { account_id: f.accounts["3000"], debit: "0.00", credit: "100.00", description: "Synthetic capital" }
      ] }));
      const flow = (await call("SELECT public.read_cash_flow_snapshot($1,'2025-01-01'::date,'2025-01-31'::date) AS value", [f.org])).value;
      assert.equal(flow.provisional, true); money(flow.data.unclassified, "100.00");
      const period = (await f.admin.query("SELECT * FROM finance.accounting_periods WHERE organization_id=$1 AND starts_on='2025-01-01'::date AND kind='regular'", [f.org])).rows[0];
      const checklist = (await call("SELECT public.read_period_close_checklist($1,$2) AS value", [f.org, period.id])).value;
      assert.ok(checklist.checks.some(row => row.code === "cash_classification" && row.count === 1 && row.blocking));
      await assert.rejects(() => call("SELECT * FROM public.lock_accounting_period($1,$2,$3,$4,$5)", [f.org, period.id, period.row_version, request("unclassified close").id, "Synthetic unclassified close must fail"]), e => e.code === "23514");
    });
    console.log(JSON.stringify({ fixture: "cutover-classification", organizationId: org, classificationOrganizationId: f.org }));
  } finally { await f.close(); }
});
