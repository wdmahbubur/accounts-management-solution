import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import net from "node:net";
import test, { mock } from "node:test";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import PDFDocument from "pdfkit";
import { createAccountingFixture } from "./helpers/accounting-fixture.mjs";
import { fixtureRpcClient } from "./helpers/rpc-client.mjs";
import { getIssuedInvoicePdf } from "../../apps/web/server/documents/invoice-pdf-storage.ts";
import { processOutboxBatch } from "../../apps/web/server/outbox/worker.ts";

test("renderer/delivery faults and crashed worker leases never repost financial activity", { timeout: 420_000 }, async t => {
  const f = await createAccountingFixture();
  const client = fixtureRpcClient(f), actor = { organizationId: f.org, capabilities: ["sales.read"] };
  assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname, process.env.AMS_RECOVERY_STORAGE_HOST);
  assert.equal(process.env.OBJECT_STORE_BUCKET, "ams-recovery-drill");
  const s3 = new S3Client({ region: process.env.AWS_REGION, endpoint: process.env.OBJECT_STORE_ENDPOINT, forcePathStyle: true });
  const worker = new Pool({ connectionString: process.env.DATABASE_WORKER_URL, max: 1 });
  const received = [], signals = new EventEmitter(), connections = new Set();
  let stall = false, doc, pdf, event;
  const server = net.createServer(socket => {
    connections.add(socket); socket.on("close", () => connections.delete(socket)); socket.on("error", () => undefined);
    socket.setEncoding("utf8"); socket.write("220 acceptance.local ESMTP\r\n");
    let pending = "", data = false, message = [];
    socket.on("data", chunk => {
      pending += chunk;
      while (pending.includes("\r\n")) {
        const end = pending.indexOf("\r\n"), line = pending.slice(0, end); pending = pending.slice(end + 2);
        if (data) {
          if (line === ".") { data = false; received.push(message.join("\r\n")); message = []; signals.emit("message"); if (!stall) socket.write("250 2.0.0 accepted by local test fixture\r\n"); }
          else message.push(line);
        } else if (/^EHLO|^HELO/i.test(line)) socket.write("250-acceptance.local\r\n250 SIZE 10485760\r\n");
        else if (/^MAIL FROM:|^RCPT TO:|^RSET|^NOOP/i.test(line)) socket.write("250 2.0.0 OK\r\n");
        else if (/^DATA$/i.test(line)) { data = true; socket.write("354 end with dot\r\n"); }
        else if (/^QUIT$/i.test(line)) { socket.end("221 Bye\r\n"); }
        else socket.write("502 unsupported test command\r\n");
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  process.env.SMTP_URL = `smtp://127.0.0.1:${server.address().port}`; process.env.SMTP_FROM = "acceptance@example.invalid";
  process.env.NODE_ENV = "production";
  // Parent and dedicated child use the same canonical origin, preserving the
  // Message-ID across crash recovery while SMTP stays on the loopback fixture.
  process.env.NEXT_PUBLIC_APP_URL = "https://acceptance.example.invalid";
  const facts = async () => (await f.admin.query(`SELECT jsonb_build_object(
    'document',(SELECT to_jsonb(d) FROM finance.business_documents d WHERE organization_id=$1 AND id=$2),
    'journals',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM finance.journal_entries j WHERE organization_id=$1),
    'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE organization_id=$1),
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM finance.open_items i WHERE organization_id=$1),
    'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM finance.settlement_allocations a WHERE organization_id=$1)) AS value`, [f.org, doc.document_id])).rows[0].value;
  const state = async () => (await f.admin.query("SELECT * FROM finance.outbox_events WHERE organization_id=$1 AND id=$2", [f.org, event.outbox_event_id])).rows[0];
  const waitUntil = async value => { const ms = new Date(value).getTime() - Date.now() + 500; if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms)); };
  try {
    await f.admin.query("UPDATE finance.contacts SET email='worker-acceptance@example.invalid' WHERE organization_id=$1 AND id=$2", [f.org, f.contacts.customer]);
    doc = await f.posted(f.body("invoice", "100.00")); const before = await facts();
    await t.test("T-43 injected PDF renderer failure preserves the posted journal and creates no issued version", async () => {
      const injected = mock.method(PDFDocument.prototype, "text", () => { throw new Error("Injected acceptance renderer failure"); });
      try { await assert.rejects(() => getIssuedInvoicePdf(client, actor, doc.document_id), /Injected acceptance renderer failure/); }
      finally { injected.mock.restore(); }
      assert.deepEqual(await facts(), before);
      assert.equal((await f.admin.query("SELECT count(*)::integer AS n FROM finance.invoice_pdf_versions WHERE organization_id=$1", [f.org])).rows[0].n, 0);
      pdf = await getIssuedInvoicePdf(client, actor, doc.document_id); assert.ok(pdf.bytes.byteLength > 100);
    });
    await t.test("T-43 missing issued file causes delivery-only retry; restored bytes deliver through loopback SMTP", async () => {
      event = (await f.rpc("SELECT public.request_invoice_email_delivery($1,$2,$3,$4) AS value", [f.org, doc.document_id, pdf.pdfId, randomUUID()])).rows[0].value;
      const key = `${f.org}/invoice-pdfs/${pdf.pdfId}`;
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.OBJECT_STORE_BUCKET, Key: key }));
      try {
        await processOutboxBatch(10); const failed = await state(); assert.equal(failed.status, "pending"); assert.equal(failed.last_error_code, "INVOICE_PDF_UNAVAILABLE"); assert.equal(failed.attempt_count, 1);
      } finally { await s3.send(new PutObjectCommand({ Bucket: process.env.OBJECT_STORE_BUCKET, Key: key, Body: pdf.bytes, ContentType: "application/pdf", IfNoneMatch: "*" })); }
      const pending = await state(); await waitUntil(pending.available_at); await processOutboxBatch(10);
      assert.equal((await state()).status, "delivered"); assert.deepEqual(await facts(), before);
      assert.equal(createHash("sha256").update((await getIssuedInvoicePdf(client, actor, doc.document_id)).bytes).digest("hex"), createHash("sha256").update(pdf.bytes).digest("hex"));
    });
    await t.test("S-19 kill a real worker during SMTP delivery; expired lease is reclaimed and old token is fenced", async () => {
      event = (await f.rpc("SELECT public.request_invoice_email_delivery($1,$2,$3,$4) AS value", [f.org, doc.document_id, pdf.pdfId, randomUUID()])).rows[0].value;
      stall = true;
      const arrived = once(signals, "message", { signal: AbortSignal.timeout(45_000) });
      const child = fork(new URL("./helpers/run-mail-worker.mjs", import.meta.url), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: ["--conditions=react-server"] });
      const exited = once(child, "exit"); let abandoned;
      try { await arrived; abandoned = await state(); assert.equal(abandoned.status, "processing"); assert.equal(abandoned.attempt_count, 1); }
      finally { child.kill(); await exited; stall = false; }
      console.log(JSON.stringify({ stage: "worker killed during SMTP; waiting for actual lease expiry", eventId: event.outbox_event_id, leaseUntil: abandoned.lease_until }));
      await waitUntil(abandoned.lease_until);
      await processOutboxBatch(10); const completed = await state(); assert.equal(completed.status, "delivered"); assert.equal(completed.attempt_count, 2);
      await assert.rejects(() => worker.query("SELECT finance_private.complete_outbox_delivery($1,$2,$3)", [event.outbox_event_id, abandoned.lease_token, "stale-worker"]), e => e.code === "40001");
      const last = received.slice(-2).map(message => message.match(/^Message-ID:\s*(.+)$/im)?.[1]); assert.ok(last[0]); assert.equal(last[0], last[1]);
      assert.deepEqual(await facts(), before); assert.equal(new Set((await f.journal(doc)).map(row => row.journal_id)).size, 1);
    });
    console.log(JSON.stringify({ fixture: "worker-recovery", organizationId: f.org, localSmtpMessages: received.length }));
  } finally {
    for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); s3.destroy(); await worker.end(); await f.close();
  }
});
