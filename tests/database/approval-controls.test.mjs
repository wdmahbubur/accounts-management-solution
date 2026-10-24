import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, request } from "./helpers/accounting-fixture.mjs";

test("live maker-checker decisions bind material source versions", { timeout: 240_000 }, async t => {
  const f = await createAccountingFixture();
  const decide = async (approval, user, decision = "approve") => {
    const m = request(approval);
    return (await f.rpc("SELECT * FROM public.decide_financial_approval($1,$2,$3,$4,$5,$6,$7,NULL)", [f.org, approval.approval_request_id, `approvals.decide:${approval.approval_request_id}`, m.id, m.key, m.hash, decision], user)).rows[0];
  };
  const policy = async (type, allowSelf = false) => {
    const p = f.policies[type], m = request(type);
    f.policies[type] = (await f.rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,$5,$6,$7,$8,'0.00',$9,1,$10,true,$11)", [f.org, m.id, m.key, m.hash, p.policy_id, p.row_version, `Acceptance ${type}`, type, f.ownerRole, allowSelf, "Synthetic maker-checker policy acceptance"])).rows[0];
  };
  try {
    await policy("invoice");
    await t.test("T-37 self approval is denied while a separate active approver can approve", async () => {
      const doc = await f.save(f.body("invoice", "100.00")), approval = await f.submit(doc); assert.equal(approval.state, "pending");
      await assert.rejects(() => decide(approval, f.ids.owner), e => e.code === "42501");
      await assert.rejects(() => f.post(doc), e => ["P0001", "40001"].includes(e.code));
      assert.equal((await f.journal(doc)).length, 0);
      assert.equal((await decide(approval, f.ids.checker)).state, "approved"); await f.post(doc);
    });
    await t.test("T-36 amount and accounting date edits invalidate prior approval and require a new decision", async () => {
      for (const changed of [{ amount: "101.00", overrides: {} }, { amount: "100.00", overrides: { accounting_date: "2025-01-16", issue_date: "2025-01-16", due_date: "2025-01-16" } }]) {
        const original = f.body("invoice", "100.00"), doc = await f.save(original), first = await f.submit(doc); await decide(first, f.ids.checker);
        const edited = await f.save(f.body("invoice", changed.amount, changed.overrides), doc); assert.ok(edited.document_version > doc.document_version); assert.equal(edited.state, "draft");
        await assert.rejects(() => f.post(doc), e => ["P0001", "40001"].includes(e.code));
        await assert.rejects(() => f.post(edited), e => ["P0001", "40001"].includes(e.code)); assert.equal((await f.journal(edited)).length, 0);
        const second = await f.submit(edited); assert.notEqual(second.approval_request_id, first.approval_request_id); await decide(second, f.ids.checker); await f.post(edited);
        assert.equal(new Set((await f.journal(edited)).map(row => row.journal_id)).size, 1);
      }
    });
    await t.test("T-37 enabling self approval still requires the documented sole-operator exception", async () => {
      await assert.rejects(() => policy("invoice", true), e => e.code === "23514");
    });
    await t.test("T-36 changing bank or allocation target invalidates a genuine checker decision", async () => {
      const targets = [];
      for (let i = 0; i < 2; i++) {
        const doc = await f.save(f.body("invoice", "50.00")); await decide(await f.submit(doc), f.ids.checker); await f.post(doc); targets.push((await f.openItems(doc))[0].id);
      }
      const otherBank = (await f.rpc("SELECT public.save_cash_account($1,'Synthetic second bank','bank',$2,NULL,NULL,true,false) AS id", [f.org, f.accounts["1000"]])).rows[0].id;
      await policy("receipt");
      for (const change of ["bank", "target"]) {
        const original = f.body("receipt", "10.00", { allocation_plan: [{ target_open_item_id: targets[0], amount: "10.00" }] });
        const doc = await f.save(original), first = await f.submit(doc); await decide(first, f.ids.checker);
        const editedBody = change === "bank" ? { ...original, movement: { ...original.movement, cash_account_id: otherBank } } : { ...original, allocation_plan: [{ target_open_item_id: targets[1], amount: "10.00" }] };
        const edited = await f.save(editedBody, doc); assert.equal(edited.state, "draft"); assert.ok(edited.document_version > doc.document_version);
        await assert.rejects(() => f.post(edited), e => ["P0001", "40001"].includes(e.code)); assert.equal((await f.journal(edited)).length, 0);
        const second = await f.submit(edited); assert.notEqual(second.approval_request_id, first.approval_request_id); await decide(second, f.ids.checker); await f.post(edited);
      }
    });
    console.log(JSON.stringify({ fixture: "approval-controls", organizationId: f.org }));
  } finally { await f.close(); }
});
