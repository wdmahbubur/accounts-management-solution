import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, hash, money, request } from "./helpers/accounting-fixture.mjs";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { postFinancialDocumentCommand } from "../../apps/web/server/documents/posting.ts";

function barrier(size) {
  let count = 0, release;
  const ready = new Promise(resolve => { release = resolve; });
  return async () => { if (++count === size) release(); await ready; };
}
const postSql = "SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)";
const postArgs = (f, doc, meta) => [f.org, doc.document_id, doc.document_version, meta.id, meta.key, meta.hash];

test("real connection races preserve posting, capacity, physical cash and owner invariants", { timeout: 600_000 }, async t => {
  const f = await createAccountingFixture();
  const approve = async body => { const doc = await f.save(body); assert.equal((await f.submit(doc)).state, "approved"); return doc; };
  try {
    await t.test("S-09 concurrent different-key posts create exactly one journal", async () => {
      const doc = await approve(f.body("invoice", "10000.00"));
      const ready = barrier(2), pids = new Set();
      const results = await Promise.allSettled([0, 1].map(() => f.asActor(f.ids.owner, async db => {
        pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); await ready();
        return db.query(postSql, postArgs(f, doc, request("racing post")));
      })));
      assert.equal(pids.size, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const rejected = results.find(r => r.status === "rejected"); assert.ok(["23505", "40001"].includes(rejected.reason.code));
      assert.equal(new Set((await f.journal(doc)).map(row => row.journal_id)).size, 1);
    });
    await t.test("S-08 two 6000 allocations cannot consume one 10000 debit residual", async () => {
      const invoice = await f.posted(f.body("invoice", "10001.00"));
      const debit = (await f.openItems(invoice))[0].id;
      const receipt = await f.posted(f.body("receipt", "12001.00", { allocation_plan: [{ target_open_item_id: debit, amount: "1.00" }] }));
      const credit = (await f.openItems(receipt))[0].id;
      const ready = barrier(2), pids = new Set();
      const results = await Promise.allSettled([0, 1].map(() => f.asActor(f.ids.owner, async db => {
        pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); await ready();
        const m = request("racing allocation");
        return db.query("SELECT * FROM public.allocate_open_items($1,$2,$3,$4,$5,$6,'6000.00','2025-01-15'::date)", [f.org, m.id, m.key, m.hash, debit, credit]);
      })));
      assert.equal(pids.size, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(["23P01", "23514"].includes(results.find(r => r.status === "rejected").reason.code));
      const total = (await f.admin.query("SELECT sum(amount)::text AS amount FROM finance.settlement_allocations WHERE organization_id=$1 AND debit_open_item_id=$2", [f.org, debit])).rows[0].amount;
      money(total, "6001.00");
    });
    await t.test("S-11 two physical-cash spends cannot overdraw a 10000 balance", async () => {
      const cash = (await f.rpc("SELECT public.save_cash_account($1,'Synthetic physical cash','cash',$2,NULL,NULL,false,false) AS id", [f.org, f.accounts["1000"]])).rows[0].id;
      await f.posted(f.body("manual_journal", "10000.00", { journal_rows: [
        { account_id: f.accounts["1000"], debit: "10000.00", credit: "0.00", cash_flow_class: "financing", description: "Synthetic cash capital" },
        { account_id: f.accounts["3000"], debit: "0.00", credit: "10000.00", description: "Synthetic capital" }
      ] }));
      const docs = [];
      for (let i = 0; i < 2; i++) docs.push(await approve(f.body("paid_expense", "6000.00", { movement: { cash_account_id: cash, direction: "out", amount: "6000.00", method: "cash", reference: "Synthetic racing cash spend", cash_flow_class: "operating" } })));
      const ready = barrier(2), pids = new Set();
      const results = await Promise.allSettled(docs.map(doc => f.asActor(f.ids.owner, async db => {
        pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); await ready(); return db.query(postSql, postArgs(f, doc, request(doc)));
      })));
      assert.equal(pids.size, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.find(r => r.status === "rejected").reason.code, "23514");
      const balance = (await f.admin.query("SELECT sum(l.debit-l.credit)::text AS balance FROM finance.journal_lines l JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id WHERE l.organization_id=$1 AND l.account_id=$2 AND j.state='posted'", [f.org, f.accounts["1000"]])).rows[0].balance;
      money(balance, "4000.00");
    });
    await t.test("S-17 real deadlock retries the whole posting transaction with the same command envelope", async () => {
      const keys = [randomUUID(), randomUUID()];
      for (const key of keys) await f.admin.query("INSERT INTO identity.auth_rate_limits(email_hash,attempts,window_started_at) VALUES($1,0,now())", [Buffer.from(hash(key), "hex")]);
      const docs = [await approve(f.body("invoice", "17.00")), await approve(f.body("invoice", "18.00"))];
      const ready = barrier(2), pids = new Set(), attempts = [0, 0], observed = [];
      const commands = docs.map((doc, index) => {
        const client = { async rpc(name, args) {
          assert.equal(name, "post_financial_document");
          try {
            const data = await f.asActor(f.ids.owner, async db => {
              attempts[index]++;
              await db.query("SET LOCAL lock_timeout='12s'");
              await db.query("UPDATE identity.auth_rate_limits SET attempts=attempts+1 WHERE email_hash=$1", [Buffer.from(hash(keys[index]), "hex")]);
              if (attempts[index] === 1) { pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); await ready(); }
              await db.query("UPDATE identity.auth_rate_limits SET attempts=attempts+1 WHERE email_hash=$1", [Buffer.from(hash(keys[1 - index]), "hex")]);
              return (await db.query(postSql, [args.p_organization_id, args.p_document_id, args.p_expected_version, args.p_request_id, args.p_idempotency_key, args.p_request_hash])).rows;
            });
            return { data, error: null };
          } catch (error) { observed.push(error.code); return { data: null, error: { code: error.code, message: error.message } }; }
        } };
        return executeOrganizationCommand({
          definition: postFinancialDocumentCommand(client, doc.document_id, "invoice"), organizationId: f.org, rawInput: { expected_version: doc.document_version }, headers: new Headers({ "idempotency-key": randomUUID() }),
          dependencies: {
            identityVerifier: { async verifyIdentity() { return { userId: f.ids.owner }; } },
            membershipResolver: { async resolveActiveMembership() { return (await f.rpc("SELECT * FROM public.resolve_active_membership($1)", [f.org], f.ids.owner, { readOnly: true })).rows.map(r => ({ memberId: r.member_id, organizationId: r.organization_id, capabilities: r.capabilities }))[0]; } },
            generateRequestId: () => request("deadlock").id, hashRequest: value => hash(value)
          }
        });
      });
      const results = await Promise.all(commands);
      assert.equal(pids.size, 2); assert.ok(observed.includes("40P01")); assert.deepEqual(attempts.toSorted(), [1, 2]);
      for (const [i, result] of results.entries()) { assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(new Set((await f.journal(docs[i])).map(row => row.journal_id)).size, 1); }
    });
    await t.test("S-10 posting and period lock serialize in both commit orders", async () => {
      async function blocked(pid) {
        for (let i = 0; i < 30; i++) {
          const row = (await f.admin.query("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid])).rows[0];
          if (row.blocked) return;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.fail("The independent contender did not demonstrably wait on a PostgreSQL lock.");
      }
      for (const [month, lockFirst] of [["03", false], ["04", true]]) {
        const doc = await approve(f.body("invoice", "10.00", { issue_date: `2025-${month}-15`, accounting_date: `2025-${month}-15`, due_date: `2025-${month}-15` }));
        const period = (await f.admin.query("SELECT * FROM finance.accounting_periods WHERE organization_id=$1 AND starts_on=$2::date", [f.org, `2025-${month}-01`])).rows[0];
        const lock = db => db.query("SELECT * FROM public.lock_accounting_period($1,$2,$3,$4,$5)", [f.org, period.id, period.row_version, request("lock race").id, "Synthetic lock versus post rehearsal"]);
        const post = db => db.query(postSql, postArgs(f, doc, request("post race")));
        let release, ready, contenderReady, holderPid, contenderPid;
        const gate = new Promise(resolve => { release = resolve; });
        const held = new Promise(resolve => { ready = resolve; });
        const started = new Promise(resolve => { contenderReady = resolve; });
        const holder = f.asActor(f.ids.owner, async db => { holderPid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; const value = await (lockFirst ? lock(db) : post(db)); ready(); await gate; return value; });
        holder.catch(() => ready());
        await held;
        const contender = f.asActor(f.ids.owner, async db => { contenderPid = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; contenderReady(); return lockFirst ? post(db) : lock(db); });
        contender.catch(() => undefined);
        await started;
        try { assert.notEqual(holderPid, contenderPid); await blocked(contenderPid); }
        finally { release(); }
        await holder;
        if (lockFirst) { await assert.rejects(contender, e => ["23514", "55P03"].includes(e.code)); assert.equal((await f.journal(doc)).length, 0); }
        else { await contender; assert.equal(new Set((await f.journal(doc)).map(row => row.journal_id)).size, 1); }
        assert.equal((await f.admin.query("SELECT status FROM finance.accounting_periods WHERE organization_id=$1 AND id=$2", [f.org, period.id])).rows[0].status, "locked");
      }
    });
    await t.test("S-13 concurrent mutual owner removal leaves an active owner", async () => {
      const members = (await f.admin.query("SELECT user_id,id FROM finance.organization_members WHERE organization_id=$1", [f.org])).rows;
      const owners = [f.ids.owner, f.ids.checker], ready = barrier(2), pids = new Set();
      const results = await Promise.allSettled(owners.map((user, i) => f.asActor(user, async db => {
        pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); await ready();
        return db.query("SELECT * FROM public.deactivate_member($1,$2,$3)", [f.org, members.find(row => row.user_id === owners[1 - i]).id, request("owner race").id]);
      })));
      assert.equal(pids.size, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(["42501", "23514"].includes(results.find(r => r.status === "rejected").reason.code));
      const count = (await f.admin.query("SELECT count(*)::integer AS n FROM finance.organization_members m JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id JOIN finance.roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id WHERE m.organization_id=$1 AND m.status='active' AND r.template_key='owner'", [f.org])).rows[0].n;
      assert.equal(count, 1);
    });
    console.log(JSON.stringify({ fixture: "concurrency-acceptance", organizationId: f.org }));
  } finally { await f.close(); }
});
