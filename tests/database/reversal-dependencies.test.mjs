import assert from "node:assert/strict";
import test from "node:test";
import { createAccountingFixture, money } from "./helpers/accounting-fixture.mjs";
import { bankScenario, creditScenario, reverseArgs, reverseSql } from "./helpers/reversal-dependencies.mjs";

test("resolved bank match history permits a source reversal while active and finalized matches still block", { timeout: 240_000 }, async () => {
  const f = await createAccountingFixture();
  try {
    const b = await bankScenario(f), before = await f.journal(b.receipt);
    const ids = [await b.add(b.statements[0]), await b.add(b.statements[1])];
    const args = reverseArgs(f, b.receipt);
    await assert.rejects(() => f.rpc(reverseSql, args), e => e.code === "55000");
    await b.finalize();
    await assert.rejects(() => b.unmatch(ids[0]), e => e.code === "55000");
    await assert.rejects(() => f.rpc(reverseSql, args), e => e.code === "55000");
    await b.reopen(); await b.unmatch(ids[0]);
    await assert.rejects(() => f.rpc(reverseSql, args), e => e.code === "55000");
    await b.unmatch(ids[1]);
    await assert.rejects(() => f.rpc(reverseSql, args, f.ids.billing), e => e.code === "42501");
    await assert.rejects(() => f.rpc(reverseSql, args, f.ids.outsider), e => ["42501", "P0002"].includes(e.code));
    const receipt = (await f.rpc(reverseSql, args)).rows[0];
    assert.deepEqual((await f.rpc(reverseSql, args)).rows[0], receipt);
    assert.deepEqual(await f.journal(b.receipt), before);
    const opposite = await f.journal({ document_id: receipt.reversal_document_id });
    for (const [i, row] of before.entries()) { assert.equal(opposite[i].account_id, row.account_id); money(opposite[i].debit, row.credit); money(opposite[i].credit, row.debit); }
    assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.reconciliation_match_reversals WHERE organization_id=$1", [f.org])).rows[0].n, 2);
    await assert.rejects(() => b.add(b.statements[0]), e => e.code === "55000");
    console.log(JSON.stringify({ fixture: "bank-reversal-dependencies", organizationId: f.org }));
  } finally { await f.close(); }
});

for (const type of ["customer_credit", "vendor_credit"]) test(`${type}: only a posted child reversal effective by the requested date resolves its dependency`, { timeout: 240_000 }, async () => {
  const f = await createAccountingFixture();
  try {
    const { original, credit } = await creditScenario(f, type), before = await f.journal(original);
    await assert.rejects(() => f.rpc(reverseSql, reverseArgs(f, original)), e => e.code === "55000");
    await f.rpc(reverseSql, reverseArgs(f, credit, "2025-01-20"));
    await assert.rejects(() => f.rpc(reverseSql, reverseArgs(f, original, "2025-01-19")), e => e.code === "55000");
    const args = reverseArgs(f, original, "2025-01-20"), result = (await f.rpc(reverseSql, args)).rows[0];
    assert.deepEqual((await f.rpc(reverseSql, args)).rows[0], result);
    assert.deepEqual(await f.journal(original), before);
    const aging = (await f.rpc("SELECT public.read_aging_snapshot($1,$2,'2025-01-20') AS value", [f.org, type === "customer_credit" ? "ar" : "ap"], f.ids.owner, { readOnly: true })).rows[0].value.data;
    money(aging.net_trade_control_items, "0.00"); money(aging.trade_control_ledger, "0.00"); money(aging.net_bridge_difference, "0.00");
    console.log(JSON.stringify({ fixture: type + "-reversal-dependency", organizationId: f.org }));
  } finally { await f.close(); }
});

test("independent bank mutation/source-reversal races cannot leave a live match on a reversed source", { timeout: 360_000 }, async t => {
  const f = await createAccountingFixture();
  async function race(commands) {
    let ready = 0, release;
    const gate = new Promise(resolve => { release = resolve; }), pids = new Set();
    const results = await Promise.allSettled(commands.map(command => f.asActor(f.ids.owner, async db => {
      pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      if (++ready === commands.length) release(); await gate;
      return command(db);
    })));
    assert.equal(pids.size, commands.length);
    return results;
  }
  const invariant = async () => assert.equal((await f.admin.query(`SELECT count(*)::integer AS n
    FROM finance.reconciliation_matches m JOIN finance.journal_lines l ON l.organization_id=m.organization_id AND l.id=m.journal_line_id
    JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
    JOIN finance.business_documents r ON r.organization_id=j.organization_id AND r.reversal_of_document_id=j.source_document_id AND r.state='posted'
    WHERE m.organization_id=$1 AND NOT EXISTS(SELECT 1 FROM finance.reconciliation_match_reversals z WHERE z.organization_id=m.organization_id AND z.match_id=m.id)`, [f.org])).rows[0].n, 0);
  try {
    await t.test("finalize/source reversal and finalize/unmatch races preserve active finalized evidence", async () => {
      const b = await bankScenario(f), ids = [await b.add(b.statements[0]), await b.add(b.statements[1])];
      const finalize = db => db.query("SELECT public.finalize_reconciliation($1,$2,$3)", [f.org, b.reconciliation, reverseArgs(f, b.receipt)[4]]);
      let results = await race([db => db.query(reverseSql, reverseArgs(f, b.receipt)), finalize]);
      assert.equal(results[0].status, "rejected"); assert.equal(results[0].reason.code, "55000"); assert.equal(results[1].status, "fulfilled");
      await b.reopen();
      results = await race([
        finalize,
        db => db.query("SELECT public.reverse_reconciliation_match($1,$2,$3,'Synthetic race correction',$4)", [f.org, b.reconciliation, ids[0], reverseArgs(f, b.receipt)[4]])
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(["55000", "23514"].includes(results.find(r => r.status === "rejected").reason.code));
      const state = (await f.admin.query("SELECT state FROM finance.reconciliations WHERE organization_id=$1 AND id=$2", [f.org, b.reconciliation])).rows[0].state;
      if (state === "finalized") await b.reopen();
      for (const id of ids) if (!(await f.admin.query("SELECT 1 FROM finance.reconciliation_match_reversals WHERE organization_id=$1 AND match_id=$2", [f.org, id])).rowCount) await b.unmatch(id);
      await invariant();
    });
    await t.test("new match versus source reversal has one winner", async () => {
      const b = await bankScenario(f), args = reverseArgs(f, b.receipt);
      const results = await race([
        db => db.query(reverseSql, args),
        db => db.query("SELECT public.add_reconciliation_match($1,$2,$3,$4,'60.00',$5)", [f.org, b.reconciliation, b.statements[0].id, b.book, args[4]])
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.find(r => r.status === "rejected").reason.code, "55000"); await invariant();
    });
    await t.test("unmatch versus source reversal is serialized before reading dependencies", async () => {
      const b = await bankScenario(f), match = await b.add(b.statements[0]);
      const results = await race([
        db => db.query(reverseSql, reverseArgs(f, b.receipt)),
        db => db.query("SELECT public.reverse_reconciliation_match($1,$2,$3,'Synthetic race correction',$4)", [f.org, b.reconciliation, match, reverseArgs(f, b.receipt)[4]])
      ]);
      assert.equal(results[1].status, "fulfilled");
      if (results[0].status === "rejected") { assert.equal(results[0].reason.code, "55000"); await f.rpc(reverseSql, reverseArgs(f, b.receipt)); }
      await invariant();
    });
    await t.test("different-key source reversals still produce one opposite journal", async () => {
      const source = (await bankScenario(f)).receipt;
      const results = await race([0, 1].map(() => db => db.query(reverseSql, reverseArgs(f, source))));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.find(r => r.status === "rejected").reason.code, "P0001");
      const count = (await f.admin.query("SELECT count(*)::integer AS n FROM finance.business_documents WHERE organization_id=$1 AND reversal_of_document_id=$2", [f.org, source.document_id])).rows[0].n;
      assert.equal(count, 1); await invariant();
    });
    console.log(JSON.stringify({ fixture: "reversal-dependency-races", organizationId: f.org, independentConnections: 2 }));
  } finally { await f.close(); }
});
