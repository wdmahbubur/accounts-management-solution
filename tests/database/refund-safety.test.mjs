import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, request } from "./helpers/accounting-fixture.mjs";

test("T-13 refund cannot post without explicitly selected eligible credit settlement", { timeout: 120_000 }, async () => {
  const f = await createAccountingFixture();
  try {
    await f.posted(f.body("manual_journal", "1000.00", { journal_rows: [
      { account_id: f.accounts["1010"], debit: "1000.00", credit: "0.00", description: "Synthetic refund-safety capital", cash_flow_class: "financing" },
      { account_id: f.accounts["3000"], debit: "0.00", credit: "1000.00", description: "Synthetic capital" }
    ] }));
    for (const [type, party, direction] of [["customer_refund", f.contacts.customer, "out"], ["vendor_refund", f.contacts.vendor, "in"]]) {
      const m = request(type);
      await f.rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'99999.00',$7,1,false,true,$8)", [f.org, m.id, m.key, m.hash, `Synthetic ${type}`, type, f.ownerRole, "Synthetic refund boundary acceptance"]);
      const body = f.body(type, "1.00", { party_id: party, movement: { cash_account_id: f.cash, direction, amount: "1.00", method: "bank_transfer", reference: "Synthetic credit-free refund must fail", cash_flow_class: "operating" } });
      const doc = await f.save(body); assert.equal((await f.submit(doc)).state, "approved");
      await assert.rejects(() => f.post(doc), e => e.code === "23514");
      assert.equal((await f.journal(doc)).length, 0);
    }
    console.log(JSON.stringify({ fixture: "refund-safety", organizationId: f.org }));
  } finally { await f.close(); }
});
