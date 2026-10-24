import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, money } from "./helpers/accounting-fixture.mjs";
import { reverseArgs, reverseSql } from "./helpers/reversal-dependencies.mjs";

for (const type of ["invoice", "bill"]) test(`${type} register and detail distinguish payment, dated reversal and future posting`, { timeout: 360_000 }, async t => {
  const year = new Date(Date.now() + 6 * 60 * 60 * 1000).getUTCFullYear();
  const f = await createAccountingFixture({ booksStart: `${year}-01-01`, date: `${year}-01-01` });
  const register = type === "invoice" ? "read_invoice_register" : "read_bill_register";
  const lifecycle = type === "invoice" ? "read_invoice_lifecycle" : "read_supplier_document_lifecycle";
  const rows = (status = "all", search = null, after = null, limit = 101, user = f.ids.owner) => f.rpc(`SELECT * FROM public.${register}($1,$2,$3,$4,$5)`, [f.org, status, search, after, limit], user, { readOnly: true }).then(r => r.rows);
  const detail = (doc, user = f.ids.owner) => f.rpc(`SELECT public.${lifecycle}($1,$2) AS value`, [f.org, doc.document_id], user, { readOnly: true }).then(r => r.rows[0].value);
  async function state(doc, expected, residual, overdue) {
    const row = (await rows()).find(r => r.id === doc.document_id), page = await detail(doc);
    assert.ok(row);
    for (const result of [row, page]) {
      assert.equal(result.settlement_status, expected);
      if (residual === null) assert.equal(result.residual_amount, null); else money(result.residual_amount, residual);
    }
    assert.equal(page.overdue, overdue);
    if (type === "invoice") assert.equal(row.overdue, overdue);
  }
  try {
    const { today, future } = (await f.admin.query("SELECT (now() AT TIME ZONE 'Asia/Dhaka')::date AS today, ((now() AT TIME ZONE 'Asia/Dhaka')::date+1) AS future")).rows[0];
    // The adjacent-year calendar is test setup only when the suite runs on 31 December.
    if (!future.startsWith(String(year))) {
      const nextYear = (await f.admin.query("INSERT INTO finance.fiscal_years(organization_id,label,starts_on,ends_on) VALUES($1,$2,$3,$4) RETURNING id", [f.org, `Synthetic ${year + 1}`, `${year + 1}-01-01`, `${year + 1}-12-31`])).rows[0].id;
      await f.admin.query("INSERT INTO finance.accounting_periods(organization_id,fiscal_year_id,label,starts_on,ends_on) VALUES($1,$2,'Synthetic January',$3,$4)", [f.org, nextYear, `${year + 1}-01-01`, `${year + 1}-01-31`]);
    }
    const draft = await f.save(f.body(type, "100.00"));
    await state(draft, "not_posted", null, false);
    const paid = await f.posted(f.body(type, "100.00"));
    await state(paid, "unpaid", "100.00", today > f.date);
    const target = (await f.openItems(paid))[0].id;
    const payment = amount => f.posted(f.body(type === "invoice" ? "receipt" : "vendor_payment", amount, { allocation_plan: [{ target_open_item_id: target, amount }] }));
    await payment("40.00"); await state(paid, "partially_paid", "60.00", today > f.date);
    await payment("60.00"); await state(paid, "paid", "0.00", false);
    const reversed = await f.posted(f.body(type, "100.00")), original = await f.journal(reversed);
    await f.rpc(reverseSql, reverseArgs(f, reversed, today));
    await t.test("effective reversal is explicit and never called paid", () => state(reversed, "reversed", "0.00", false));
    assert.deepEqual(await f.journal(reversed), original);
    const scheduled = await f.posted(f.body(type, "100.00"));
    await f.rpc(reverseSql, reverseArgs(f, scheduled, future));
    await t.test("future reversal does not alter today's status or balance", () => state(scheduled, "unpaid", "100.00", today > f.date));
    await t.test("company-local date controls reversal availability", async () => {
      const zones = (await f.admin.query("SELECT name,(now() AT TIME ZONE name)::date AS local_date FROM pg_timezone_names WHERE name IN ('Etc/GMT+12','Pacific/Kiritimati') AND (now() AT TIME ZONE name)::date<>$1::date LIMIT 1", [today])).rows;
      assert.equal(zones.length, 1);
      try {
        await f.admin.query("UPDATE finance.organizations SET timezone=$2 WHERE id=$1", [f.org, zones[0].name]);
        if (zones[0].local_date < f.date) await state(reversed, "not_yet_effective", null, false);
        else if (zones[0].local_date < today) await state(reversed, "unpaid", "100.00", zones[0].local_date > f.date);
        else await state(scheduled, "reversed", "0.00", false);
      } finally { await f.admin.query("UPDATE finance.organizations SET timezone='Asia/Dhaka' WHERE id=$1", [f.org]); }
    });
    const futureSource = await f.posted(f.body(type, "100.00", { accounting_date: future, due_date: future }));
    await t.test("future source has no current outstanding amount or overdue flag", () => state(futureSource, "not_yet_effective", null, false));
    const facts = async () => (await f.admin.query(`SELECT md5(string_agg(to_jsonb(l)::text,'' ORDER BY l.id)) AS fingerprint
      FROM finance.journal_lines l WHERE organization_id=$1`, [f.org])).rows[0].fingerprint;
    const before = await facts();
    const all = await rows();
    assert.equal((await rows("drafts")).length, 1);
    assert.equal((await rows("posted")).length, 4);
    const numbered = all.find(r => r.id === paid.document_id);
    assert.deepEqual((await rows("all", numbered.document_number)).map(r => r.id), [paid.document_id]);
    const first = await rows("all", null, null, 2);
    assert.deepEqual(first.map(r => r.id), all.slice(0, 2).map(r => r.id));
    assert.deepEqual((await rows("all", null, first.at(-1).id)).map(r => r.id), all.slice(2).map(r => r.id));
    await assert.rejects(() => rows("invalid"), e => e.code === "22023");
    await assert.rejects(() => rows("all", null, null, 101, f.ids.outsider), e => e.code === "42501");
    await assert.rejects(() => detail(reversed, f.ids.outsider), e => ["42501", "P0002"].includes(e.code));
    const revoked = (await f.admin.query("DELETE FROM finance.member_roles WHERE organization_id=$1 AND member_id=(SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2) RETURNING role_id,member_id", [f.org, f.ids.checker])).rows;
    assert.ok(revoked.length);
    await assert.rejects(() => rows("all", null, null, 101, f.ids.checker), e => e.code === "42501");
    await assert.rejects(() => detail(reversed, f.ids.checker), e => e.code === "42501");
    assert.equal(await facts(), before);
    const bridge = (await f.rpc("SELECT public.read_aging_snapshot($1,$2,$3) AS value", [f.org, type === "invoice" ? "ar" : "ap", today], f.ids.owner, { readOnly: true })).rows[0].value.data;
    money(bridge.net_bridge_difference, "0.00");
    console.log(JSON.stringify({ fixture: `${type}-register-status`, organizationId: f.org, today, future, immutableJournal: true, zeroControlBridge: true }));
  } finally { await f.close(); }
});
