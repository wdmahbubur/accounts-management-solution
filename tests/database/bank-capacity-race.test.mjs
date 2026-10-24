import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, request } from "./helpers/accounting-fixture.mjs";
import { readStatementMatrix, mapStatementRows } from "../../apps/web/server/banking/statement-import.ts";

test("S-12 two sessions competing for one statement row cannot over-match it", { timeout: 180_000 }, async () => {
  const f = await createAccountingFixture();
  try {
    const invoice = await f.posted(f.body("invoice", "100.00")), item = (await f.openItems(invoice))[0].id;
    const receipt = await f.posted(f.body("receipt", "100.00", { allocation_plan: [{ target_open_item_id: item, amount: "100.00" }] }));
    const book = (await f.journal(receipt)).find(row => row.code === "1010").id;
    const equalFile = await readStatementMatrix(new File(["Date,Description,Debit,Credit,Reference\n2025-01-10,Legitimate equal transfer,,5.00,\n2025-01-10,Legitimate equal transfer,,5.00,\n"], "synthetic-equal.csv", { type: "text/csv" }));
    const equalRows = mapStatementRows(equalFile.matrix, { date: 0, description: 1, debit: 2, credit: 3, reference: 4 }); assert.deepEqual(equalRows.errors, []);
    const equalImport = (await f.rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea) AS value", [f.org, f.cash, equalFile.sha256, "synthetic-equal.csv", JSON.stringify(equalRows.rows), equalFile.bytes])).rows[0].value;
    const retained = (await f.admin.query("SELECT id,review_required,amount::text FROM finance.statement_lines WHERE organization_id=$1 AND import_id=$2", [f.org, equalImport.id])).rows;
    assert.equal(retained.length, 2); assert.notEqual(retained[0].id, retained[1].id); assert.ok(retained.every(row => row.review_required && row.amount === "5.00"));
    const csv = "Date,Description,Debit,Credit,Reference\n2025-01-15,Synthetic receipt,,60.00,capacity-race\n";
    const source = await readStatementMatrix(new File([csv], "synthetic-capacity.csv", { type: "text/csv" }));
    const mapped = mapStatementRows(source.matrix, { date: 0, description: 1, debit: 2, credit: 3, reference: 4 }); assert.deepEqual(mapped.errors, []);
    const imported = (await f.rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea) AS value", [f.org, f.cash, source.sha256, "synthetic-capacity.csv", JSON.stringify(mapped.rows), source.bytes])).rows[0].value;
    const replay = (await f.rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea) AS value", [f.org, f.cash, source.sha256, "synthetic-capacity.csv", JSON.stringify(mapped.rows), source.bytes])).rows[0].value;
    assert.equal(replay.id, imported.id); assert.equal(replay.duplicate, true);
    const providerReplay = await readStatementMatrix(new File([csv + "\n"], "synthetic-provider-reimport.csv", { type: "text/csv" }));
    const repeatedRows = mapStatementRows(providerReplay.matrix, { date: 0, description: 1, debit: 2, credit: 3, reference: 4 }); assert.deepEqual(repeatedRows.errors, []);
    await assert.rejects(() => f.rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea)", [f.org, f.cash, providerReplay.sha256, "synthetic-provider-reimport.csv", JSON.stringify(repeatedRows.rows), providerReplay.bytes]), e => e.code === "23505");
    assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.statement_lines WHERE organization_id=$1 AND source_transaction_id='capacity-race'", [f.org])).rows[0].n, 1);
    const line = (await f.admin.query("SELECT id FROM finance.statement_lines WHERE organization_id=$1 AND import_id=$2", [f.org, imported.id])).rows[0].id;
    const sessions = [];
    for (const start of ["2025-01-14", "2025-01-15"]) sessions.push((await f.rpc("SELECT public.create_reconciliation($1,$2,$3::date,'2025-01-15'::date,'0.00','60.00',$4) AS id", [f.org, f.cash, start, request("bank race session").id])).rows[0].id);
    let count = 0, release; const gate = new Promise(resolve => { release = resolve; }), pids = new Set();
    const before = await f.journal(receipt);
    const results = await Promise.allSettled(sessions.map(session => f.asActor(f.ids.owner, async db => {
      pids.add((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid); if (++count === 2) release(); await gate;
      return db.query("SELECT public.add_reconciliation_match($1,$2,$3,$4,'40.00',$5) AS id", [f.org, session, line, book, request(randomUUID()).id]);
    })));
    assert.equal(pids.size, 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.code, "23514");
    const matched = (await f.admin.query("SELECT sum(amount)::text AS amount FROM finance.reconciliation_matches WHERE organization_id=$1 AND statement_line_id=$2", [f.org, line])).rows[0].amount;
    assert.equal(matched, "40.00"); assert.deepEqual(await f.journal(receipt), before);
    console.log(JSON.stringify({ fixture: "bank-capacity-race", organizationId: f.org, independentConnections: pids.size }));
  } finally { await f.close(); }
});
