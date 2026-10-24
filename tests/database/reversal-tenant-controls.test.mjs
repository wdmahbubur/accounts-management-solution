import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, money, request } from "./helpers/accounting-fixture.mjs";

test("append-only source reversal and dual-company composite identity checks", { timeout: 180_000 }, async t => {
  const f = await createAccountingFixture();
  let source, original;
  try {
    await t.test("T-23/T-24 reversal appends exact opposite dated rows, replay succeeds and a second reversal fails", async () => {
      source = await f.posted(f.body("invoice", "100.01")); original = await f.journal(source);
      const meta = request("reverse"), args = [f.org, source.document_id, "2025-01-16", "Synthetic exact opposite acceptance reversal", meta.id, meta.key, meta.hash];
      const sql = "SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)";
      const result = (await f.rpc(sql, args)).rows[0];
      const reversed = await f.journal({ document_id: result.reversal_document_id });
      assert.equal(reversed.length, original.length); assert.notEqual(result.reversal_document_id, source.document_id);
      for (const [i, row] of original.entries()) { assert.equal(reversed[i].account_id, row.account_id); money(reversed[i].debit, row.credit); money(reversed[i].credit, row.debit); }
      assert.deepEqual(await f.journal(source), original); assert.deepEqual((await f.rpc(sql, args)).rows[0], result);
      const repeat = request("second reversal"); await assert.rejects(() => f.rpc(sql, [...args.slice(0, 4), repeat.id, repeat.key, repeat.hash]), e => e.code === "P0001");
      for (const [asOf, expected] of [["2025-01-15", "100.01"], ["2025-01-16", "0.00"]]) {
        const data = (await f.rpc("SELECT public.read_aging_snapshot($1,'ar',$2::date) AS value", [f.org, asOf], f.ids.owner, { readOnly: true })).rows[0].value.data;
        money(data.net_trade_control_items, expected); money(data.trade_control_ledger, expected); money(data.net_bridge_difference, "0.00");
      }
    });
    await t.test("S-01/S-02 one user with membership in two companies cannot mix accounts or source UUIDs", async () => {
      const foreign = (await f.rpc("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2025-01-01'::date,$2)", [`Synthetic foreign books ${randomUUID()}`, randomUUID()])).rows[0].organization_id;
      const m = request("foreign zero"); await f.rpc("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)", [foreign, m.id, m.key, m.hash]);
      const foreignAccount = (await f.admin.query("SELECT id FROM finance.accounts WHERE organization_id=$1 AND code='4000'", [foreign])).rows[0].id;
      await assert.rejects(() => f.save(f.body("invoice", "1.00", { lines: [f.line("1.00", foreignAccount)] })), e => ["23503", "23514", "42501"].includes(e.code));
      await assert.rejects(() => f.rpc("SELECT public.read_financial_document($1,$2)", [foreign, source.document_id], f.ids.owner, { readOnly: true }), e => e.code === "P0002");
      await assert.rejects(() => f.rpc("SELECT public.read_financial_document($1,$2)", [f.org, source.document_id], f.ids.outsider, { readOnly: true }), e => ["P0002", "42501"].includes(e.code));
      assert.deepEqual(await f.journal(source), original);
    });
    await t.test("S-06 anonymous and ordinary callers cannot invoke private posting helpers", async () => {
      await assert.rejects(() => f.rpc("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)", [f.org, source.document_id, source.document_version, request("anonymous").id, randomUUID(), "a".repeat(64)], ""), e => ["28000", "P0002"].includes(e.code));
      await assert.rejects(() => f.rpc("SELECT finance_private.lock_accounting_date($1,'2025-01-15'::date,false)", [f.org]), e => e.code === "42501");
      await assert.rejects(() => f.rpc("SELECT finance_private.enqueue_outbox_event($1,'document.posted',$2,$3,'{}'::jsonb)", [f.org, source.document_id, randomUUID()]), e => e.code === "42501");
    });
    console.log(JSON.stringify({ fixture: "reversal-tenant-controls", organizationId: f.org }));
  } finally { await f.close(); }
});
