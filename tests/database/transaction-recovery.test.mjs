import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import { createAccountingFixture, hash, request } from "./helpers/accounting-fixture.mjs";
import { executeOrganizationCommand } from "../../apps/web/server/commands/execute.ts";
import { postFinancialDocumentCommand } from "../../apps/web/server/documents/posting.ts";

test("whole-transaction retry bounds and process death after commit", { timeout: 300_000 }, async t => {
  const f = await createAccountingFixture();
  const approve = async () => { const doc = await f.save(f.body("invoice", "100.00")); assert.equal((await f.submit(doc)).state, "approved"); return doc; };
  async function execute(doc, fault) {
    let attempts = 0;
    const envelopes = [], errors = [];
    const client = { async rpc(name, args) {
      assert.equal(name, "post_financial_document"); envelopes.push(args); attempts++;
      try {
        const data = await f.asActor(f.ids.owner, async db => {
          const count = (await db.query("SELECT count(*)::integer AS n FROM finance.journal_entries WHERE organization_id=$1 AND source_document_id=$2", [f.org, doc.document_id])).rows[0].n;
          assert.equal(count, 0, "A rolled-back attempt must leave no source journal.");
          const rows = (await db.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)", [args.p_organization_id, args.p_document_id, args.p_expected_version, args.p_request_id, args.p_idempotency_key, args.p_request_hash])).rows;
          const error = fault(attempts);
          if (error) await db.query(`DO $$ BEGIN RAISE EXCEPTION '${error.message}' USING ERRCODE='${error.code}'; END $$`);
          return rows;
        });
        return { data, error: null };
      } catch (error) { errors.push(error.code); return { data: null, error: { code: error.code, message: error.message } }; }
    } };
    const result = await executeOrganizationCommand({
      definition: postFinancialDocumentCommand(client, doc.document_id, "invoice"), organizationId: f.org, rawInput: { expected_version: doc.document_version }, headers: new Headers({ "idempotency-key": randomUUID() }),
      dependencies: {
        identityVerifier: { async verifyIdentity() { return { userId: f.ids.owner }; } },
        membershipResolver: { async resolveActiveMembership() { const row = (await f.rpc("SELECT * FROM public.resolve_active_membership($1)", [f.org], f.ids.owner, { readOnly: true })).rows[0]; return { memberId: row.member_id, organizationId: row.organization_id, capabilities: row.capabilities }; } },
        generateRequestId: () => request("transaction recovery").id, hashRequest: value => hash(value)
      }
    });
    for (const envelope of envelopes) assert.deepEqual(envelope, envelopes[0], "Retries must retain identical request/hash/key/version.");
    return { result, attempts, errors };
  }
  try {
    await t.test("S-17 serialization aborts after posting roll back all facts and retry at most three times", async () => {
      const doc = await approve();
      const execution = await execute(doc, attempt => attempt < 3 ? { code: "40001", message: "could not serialize access due to acceptance fault injection" } : null);
      assert.equal(execution.result.status, 200); assert.equal(execution.attempts, 3); assert.deepEqual(execution.errors, ["40001", "40001"]);
      assert.equal(new Set((await f.journal(doc)).map(row => row.journal_id)).size, 1);
      const counts = (await f.admin.query("SELECT (SELECT count(*)::integer FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2 AND event_type='document.posted') AS events,(SELECT count(*)::integer FROM finance.idempotency_requests WHERE organization_id=$1 AND resource_document_id=$2 AND operation LIKE 'documents.post:%') AS receipts", [f.org, doc.document_id])).rows[0];
      assert.deepEqual(counts, { events: 1, receipts: 1 });
    });
    await t.test("S-17 exhausted serialization retries return 503 with no partial ledger or outbox", async () => {
      const doc = await approve();
      const execution = await execute(doc, () => ({ code: "40001", message: "could not serialize access due to acceptance fault injection" }));
      assert.equal(execution.result.status, 503); assert.equal(execution.attempts, 3); assert.equal((await f.journal(doc)).length, 0);
      assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2 AND event_type='document.posted'", [f.org, doc.document_id])).rows[0].n, 0);
    });
    await t.test("S-17 stale approval/version conflicts are not retried as serialization failures", async () => {
      const doc = await approve(); const execution = await execute(doc, () => ({ code: "40001", message: "approved source version is stale" }));
      assert.equal(execution.result.status, 409); assert.equal(execution.attempts, 1); assert.equal((await f.journal(doc)).length, 0);
    });
    await t.test("S-18 kill a posting process after COMMIT before response; replay returns the existing journal", async () => {
      const doc = await approve(), meta = request("crash after commit");
      const child = fork(new URL("./helpers/commit-without-response.mjs", import.meta.url), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: ["--conditions=react-server"] });
      const exited = once(child, "exit");
      try {
        const message = once(child, "message", { signal: AbortSignal.timeout(30_000) });
        child.send({ actor: f.ids.owner, args: [f.org, doc.document_id, doc.document_version, meta.id, meta.key, meta.hash] });
        assert.deepEqual((await message)[0], { boundary: "committed-before-response" });
      } finally { child.kill(); await exited; }
      const original = await f.journal(doc); assert.equal(new Set(original.map(row => row.journal_id)).size, 1);
      const replay = await f.post(doc, meta); assert.equal(replay.journal_entry_id, original[0].journal_id); assert.deepEqual(await f.journal(doc), original);
      assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.outbox_events WHERE organization_id=$1 AND document_id=$2 AND event_type='document.posted' AND status='pending'", [f.org, doc.document_id])).rows[0].n, 1);
    });
    console.log(JSON.stringify({ fixture: "transaction-recovery", organizationId: f.org }));
  } finally { await f.close(); }
});
