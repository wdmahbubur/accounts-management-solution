import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "@neondatabase/serverless";
import ExcelJS from "exceljs";
import { createAccountingFixture, request } from "./helpers/accounting-fixture.mjs";
import { processTrialBalanceExportBatch } from "../../apps/web/server/exports/worker.ts";
import { readPrivateObject } from "../../apps/web/server/storage/private.ts";
import { putPrivateExport } from "../../apps/web/server/exports/private-storage.ts";
import { readPrivateArtifact } from "../../apps/web/server/artifacts/download.ts";
import { fixtureRpcClient } from "./helpers/rpc-client.mjs";

test("report exports retain screen filters/cutoff and private download authorization", { timeout: 300_000 }, async t => {
  const f = await createAccountingFixture();
  assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname, process.env.AMS_RECOVERY_STORAGE_HOST);
  assert.equal(process.env.OBJECT_STORE_BUCKET, "ams-recovery-drill");
  const worker = new Pool({ connectionString: process.env.DATABASE_WORKER_URL, max: 1 });
  const client = fixtureRpcClient(f);
  const filters = { from: "2025-01-01", to: "2025-01-31" }, jobs = [];
  let trial, pl, original;
  const capture = async (type, filters) => (await f.rpc("SELECT public.capture_report_export_snapshot($1,$2,$3::jsonb) AS value", [f.org, type, JSON.stringify(filters)])).rows[0].value;
  const authorize = (id, user = f.ids.owner, org = f.org) => f.rpc("SELECT * FROM public.authorize_artifact_download($1,'exports',$2)", [org, id], user, { readOnly: true });
  async function output(job) {
    const row = (await f.admin.query("SELECT * FROM finance.export_jobs WHERE organization_id=$1 AND id=$2", [f.org, job.id])).rows[0];
    assert.equal(row.status, "completed", JSON.stringify({ status: row.status, error: row.error_code }));
    const permitted = (await authorize(job.id)).rows[0]; assert.equal(permitted.object_key, `${f.org}/exports/${job.id}`);
    const bytes = await readPrivateObject(permitted.object_key); assert.ok(bytes); assert.equal(bytes.byteLength, Number(permitted.expected_size));
    const artifact = await readPrivateArtifact(client, f.org, "exports", job.id);
    assert.deepEqual(Buffer.from(await artifact.bytes.arrayBuffer()), Buffer.from(bytes));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), row.output_sha256);
    return bytes;
  }
  try {
    // Synthetic presentation fixture; posted financial facts are never changed.
    await f.admin.query("UPDATE finance.organizations SET name='=2+2' WHERE id=$1", [f.org]);
    await f.posted(f.body("invoice", "100.00"));
    trial = await capture("trial_balance", { as_of: "2025-01-31", from: "2025-01-01" }); pl = await capture("profit_and_loss", filters); original = structuredClone(pl);
    await t.test("T-44 queue CSV/PDF/XLSX exports bound to the same immutable report snapshot", async () => {
      const m = request("trial export");
      jobs.push((await f.rpc("SELECT public.request_trial_balance_export($1,$2,$3,$4,'2025-01-31'::date,'2025-01-01'::date,$5,'csv') AS value", [f.org, m.id, m.key, m.hash, trial.snapshot_id])).rows[0].value);
      for (const format of ["csv", "pdf", "xlsx"]) {
        const m = request(format);
        jobs.push((await f.rpc("SELECT public.request_report_export($1,$2,$3,$4,'profit_and_loss',$5,$6::jsonb) AS value", [f.org, m.id, m.key, m.hash, format, JSON.stringify({ ...filters, export_snapshot_id: pl.snapshot_id })])).rows[0].value);
      }
      const m2 = request("wrong filter");
      await assert.rejects(() => f.rpc("SELECT public.request_trial_balance_export($1,$2,$3,$4,'2025-02-28'::date,'2025-01-01'::date,$5,'csv') AS value", [f.org, m2.id, m2.key, m2.hash, trial.snapshot_id]), e => e.code === "22023");
      await f.posted(f.body("invoice", "200.00"));
      assert.deepEqual(pl, original);
      await processTrialBalanceExportBatch(3); await processTrialBalanceExportBatch(3);
    });
    await t.test("T-44 CSV rows equal the original screen snapshot despite later postings", async () => {
      const csv = new TextDecoder().decode(await output(jobs[0]));
      for (const row of trial.data) {
        const values = [row.account_code, row.account_name, row.account_type, row.opening_balance, row.movement_debit, row.movement_credit, row.closing_debit, row.closing_credit];
        const expected = values.map(value => `"${String(value).replaceAll('"', '""')}"`).join(","); assert.ok(csv.includes(expected), expected);
      }
      assert.ok(csv.includes(trial.ledger_cutoff_at));
      assert.ok(csv.includes('"Company","\'=2+2"'), "CSV company text must be escaped as data.");
      const report = new TextDecoder().decode(await output(jobs[1]));
      assert.ok(report.includes('"report.totals.net_profit","100.00"')); assert.ok(report.includes(pl.ledger_cutoff_at));
      assert.ok(report.includes('"Filter: from","2025-01-01"')); assert.ok(report.includes('"Filter: to","2025-01-31"'));
    });
    await t.test("T-44 PDF and XLSX are real private files; XLSX retains the exact original profit", async () => {
      assert.equal(new TextDecoder().decode((await output(jobs[2])).subarray(0, 5)), "%PDF-");
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await output(jobs[3])));
      const sheet = workbook.worksheets[0], values = [];
      sheet.eachRow(row => { values.push(row.values); });
      assert.ok(values.some(row => row[1] === "report.totals.net_profit" && row[2] === "100.00"));
      assert.ok(values.some(row => row[1] === "Ledger cutoff at" && row[2] === pl.ledger_cutoff_at));
      assert.ok(values.some(row => row[1] === "Company" && row[2] === "=2+2"), "XLSX company cell must remain a literal string.");
    });
    await t.test("S-01/S-03/S-14 guessed IDs, another tenant, Billing and revoked requesters cannot download", async () => {
      for (const user of [f.ids.outsider, f.ids.billing]) await assert.rejects(() => authorize(jobs[0].id, user), e => ["P0002", "42501"].includes(e.code));
      await assert.rejects(() => authorize(randomUUID()), e => e.code === "P0002");
      await assert.rejects(() => authorize(jobs[0].id, f.ids.owner, randomUUID()), e => e.code === "P0002");
      const member = (await f.admin.query("SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2", [f.org, f.ids.owner])).rows[0].id;
      await f.rpc("SELECT public.deactivate_member($1,$2,$3)", [f.org, member, request("revoke exporter").id], f.ids.checker);
      await assert.rejects(() => authorize(jobs[0].id), e => e.code === "P0002");
      await assert.rejects(() => readPrivateArtifact(client, f.org, "exports", jobs[0].id), e => e.code === "NOT_FOUND");
    });
    await t.test("S-16 malformed export paths cannot write or read storage", async () => {
      for (const key of ["../escape", `${f.org}/exports/../../escape`, `${f.org}/exports/%2e%2e`, `${f.org}/exports/${randomUUID()}.csv`, `C:\\escape`]) {
        assert.equal(await putPrivateExport(key, new TextEncoder().encode("synthetic")), false); assert.equal(await readPrivateObject(key), null);
      }
    });
    console.log(JSON.stringify({ fixture: "export-acceptance", organizationId: f.org, jobs: jobs.map(row => row.id) }));
  } finally { await worker.end(); await f.close(); }
});
