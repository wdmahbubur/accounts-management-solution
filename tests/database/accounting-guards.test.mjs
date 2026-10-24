import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, money, request } from "./helpers/accounting-fixture.mjs";

test("tax, rounding, asset treatment, immutable books and invalid monetary inputs", { timeout: 600_000 }, async t => {
  const f = await createAccountingFixture();
  const deniedValidation = action => assert.rejects(action, error => ["22023", "23514", "22003"].includes(error.code));
  const journalCount = async () => (await f.admin.query("SELECT count(*)::text AS count FROM finance.journal_entries WHERE organization_id=$1", [f.org])).rows[0].count;
  let equipment, assetDocument, fullTax, noneTax;
  const equipmentCode = `EQ${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  try {
    await f.posted(f.body("manual_journal", "100000.00", { journal_rows: [
      { description: "Synthetic journal row", account_id: f.accounts["1010"], debit: "100000.00", credit: "0.00", cash_flow_class: "financing" },
      { description: "Synthetic journal row", account_id: f.accounts["3000"], debit: "0.00", credit: "100000.00" }
    ] }));
    await t.test("T-15 paid equipment is an asset, with no forced expense or payable", async () => {
      equipment = (await f.rpc("SELECT * FROM public.save_account($1,$2,NULL,NULL,$3,'Synthetic equipment',NULL,'asset','debit','non_current_assets',NULL,true,true)", [f.org, request("equipment").id, equipmentCode])).rows[0];
      assetDocument = await f.posted(f.body("paid_expense", "1000.00", { lines: [f.line("1000.00", equipment.account_id)], movement: { cash_account_id: f.cash, direction: "out", amount: "1000.00", method: "bank_transfer", reference: "Synthetic equipment", cash_flow_class: "investing" } }));
      const rows = await f.journal(assetDocument);
      money(rows.find(row => row.account_id === equipment.account_id).debit, "1000.00");
      money(rows.find(row => row.code === "1010").credit, "1000.00");
      assert.ok(rows.every(row => !["6000", "2000"].includes(row.code)));
    });
    await t.test("T-16 recoverable and nonrecoverable illustrative tax use the correct accounts", async () => {
      for (const [code, recovery] of [["TEST10FULL", "full"], ["TEST10NONE", "none"]]) {
        const row = (await f.rpc("SELECT * FROM public.create_tax_code_version($1,$2,'Synthetic illustrative tax only',$3,'Illustrative test ten percent',10,'standard',$4,$5,$6,'2025-01-01'::date,NULL,0)", [f.org, request(code).id, code, f.accounts["2100"], recovery === "full" ? f.accounts["1200"] : null, recovery])).rows[0];
        if (recovery === "full") fullTax = row.tax_code_id; else noneTax = row.tax_code_id;
      }
      for (const [tax, amount, recoverable] of [[fullTax, "10000.00", true], [noneTax, "11000.00", false]]) {
        const doc = await f.posted(f.body("bill", "10000.00", { lines: [{ ...f.line("10000.00", f.accounts["6000"]), tax_code_id: tax }] }));
        const rows = await f.journal(doc);
        money(rows.find(row => row.code === "6000").debit, amount);
        money(rows.find(row => row.code === "2000").credit, "11000.00");
        if (recoverable) money(rows.find(row => row.code === "1200").debit, "1000.00");
        else assert.ok(rows.every(row => row.code !== "1200"));
      }
      const asset = await f.posted(f.body("paid_expense", "1100.00", { movement: { cash_account_id: f.cash, direction: "out", amount: "1100.00", method: "bank_transfer", reference: "Synthetic taxed equipment", cash_flow_class: "investing" }, lines: [{ ...f.line("1000.00", equipment.account_id), tax_code_id: noneTax }] }));
      const assetRows = await f.journal(asset);
      money(assetRows.find(row => row.account_id === equipment.account_id).debit, "1100.00");
      assert.ok(assetRows.every(row => !["6000", "1200", "2000"].includes(row.code)));
    });
    await t.test("T-17 inclusive and exclusive illustrative rates yield the same net/tax/gross", async () => {
      for (const [mode, price] of [["inclusive", "11000.00"], ["exclusive", "10000.00"]]) {
        const doc = await f.posted(f.body("invoice", price, { lines: [{ ...f.line(price), tax_code_id: fullTax, tax_mode: mode }] }));
        const rows = await f.journal(doc);
        money(rows.find(row => row.code === "1100").debit, "11000.00");
        money(rows.find(row => row.code === "4000").credit, "10000.00");
        money(rows.find(row => row.code === "2100").credit, "1000.00");
      }
    });
    await t.test("T-18 fractional quantities and half-up ties use exact decimal amounts", async () => {
      const doc = await f.posted(f.body("invoice", "1.00", { lines: [{ ...f.line("1.00"), quantity: "3.000000", unit_price: "0.335000" }] }));
      const rows = await f.journal(doc);
      money(rows.find(row => row.code === "1100").debit, "1.01");
      money(rows.find(row => row.code === "4000").credit, "1.01");
    });
    await t.test("T-19/T-50 malformed amounts, zero-value posting, excess scale and foreign currency cannot post", async () => {
      const before = await journalCount();
      for (const unitPrice of ["0.000000", "-1.000000", "NaN", "Infinity", "1.0000001", 1]) {
        await deniedValidation(() => f.posted(f.body("invoice", "1.00", { lines: [{ ...f.line("1.00"), unit_price: unitPrice }] })));
      }
      await deniedValidation(() => f.save(f.body("invoice", "1.00", { lines: [{ ...f.line("1.00"), discount_amount: "0.001" }] })));
      await deniedValidation(() => f.save(f.body("invoice", "1.00", { currency: "USD" })));
      assert.equal(await journalCount(), before);
    });
    await t.test("T-20/T-21 malformed journals and direct controls without party/items cannot commit", async () => {
      const before = await journalCount();
      for (const rows of [
        [{ description: "Synthetic journal row", account_id: f.accounts["1010"], debit: "100.00", credit: "0.00", cash_flow_class: "financing" }],
        [{ description: "Synthetic journal row", account_id: f.accounts["1010"], debit: "100.00", credit: "0.00", cash_flow_class: "financing" }, { description: "Synthetic journal row", account_id: f.accounts["3000"], debit: "0.00", credit: "99.00" }],
        [{ description: "Synthetic journal row", account_id: f.accounts["1010"], debit: "100.00", credit: "1.00", cash_flow_class: "financing" }, { description: "Synthetic journal row", account_id: f.accounts["3000"], debit: "0.00", credit: "99.00" }],
        ...["1100", "2000"].map(code => [{ description: "Synthetic journal row", account_id: f.accounts[code], debit: "100.00", credit: "0.00" }, { description: "Synthetic journal row", account_id: f.accounts["3000"], debit: "0.00", credit: "100.00" }])
      ]) await deniedValidation(() => f.posted(f.body("manual_journal", "100.00", { journal_rows: rows })));
      assert.equal(await journalCount(), before);
    });
    await t.test("T-22 the ordinary runtime cannot update or delete posted facts", async () => {
      const rows = await f.journal(assetDocument);
      for (const sql of ["UPDATE finance.journal_lines SET debit=debit+1 WHERE id=$1", "DELETE FROM finance.journal_lines WHERE id=$1"]) {
        await assert.rejects(() => f.rpc(sql, [rows[0].id]), error => error.code === "42501");
      }
      await assert.rejects(() => f.save(f.body("paid_expense", "999.00"), assetDocument), error => ["23514", "40001"].includes(error.code));
      assert.deepEqual(await f.journal(assetDocument), rows);
    });
    await t.test("T-27 a dual-role contact retains separate AR and AP without automatic netting", async () => {
      await f.posted(f.body("invoice", "1000.00", { party_id: f.contacts.dual }));
      await f.posted(f.body("bill", "400.00", { party_id: f.contacts.dual }));
      for (const [side, expected] of [["ar", "1000.00"], ["ap", "400.00"]]) {
        const data = (await f.rpc("SELECT public.read_aging_snapshot($1,$2,'2025-12-31'::date) AS value", [f.org, side], f.ids.owner, { readOnly: true })).rows[0].value.data;
        const rows = data.items.filter(row => row.party_id === f.contacts.dual);
        assert.equal(rows.length, 1); money(rows[0].residual, expected);
      }
    });
    await t.test("T-48 classification changes after use are denied and archived accounts keep history", async () => {
      await assert.rejects(() => f.rpc("SELECT * FROM public.save_account($1,$2,$3,$4,$5,'Synthetic equipment',NULL,'expense','debit','operating_expenses',NULL,true,true)", [f.org, request("reclassify").id, equipment.account_id, equipment.row_version, equipmentCode]), error => error.code === "23514");
      const before = await f.journal(assetDocument);
      await f.rpc("SELECT * FROM public.save_account($1,$2,$3,$4,$5,'Synthetic equipment',NULL,'asset','debit','non_current_assets',NULL,true,false)", [f.org, request("archive").id, equipment.account_id, equipment.row_version, equipmentCode]);
      await deniedValidation(() => f.posted(f.body("paid_expense", "1.00", { lines: [f.line("1.00", equipment.account_id)] })));
      assert.deepEqual(await f.journal(assetDocument), before);
    });
    console.log(JSON.stringify({ fixture: "accounting-guards", organizationId: f.org }));
  } finally { await f.close(); }
});
