import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createAccountingFixture } from "./helpers/accounting-fixture.mjs";
import { fixtureRpcClient } from "./helpers/rpc-client.mjs";
import { createUploadIntent, completeUpload } from "../../apps/web/server/artifacts/uploads.ts";
import { readPrivateObject, writeQuarantinedObject } from "../../apps/web/server/storage/private.ts";
import { readPrivateArtifact } from "../../apps/web/server/artifacts/download.ts";
import { processAttachmentScanBatch } from "../../apps/web/server/artifacts/scanner-worker.ts";
import { readClamAvVersion } from "../../apps/web/server/artifacts/clamav.ts";
import { parseEvidence } from "../../apps/web/server/artifacts/evidence.ts";

test("upload authorization precedes real private storage and completion replay remains scoped", { timeout: 300_000 }, async t => {
  assert.equal(process.env.AMS_SCANNER_TESTS, "real-clamav"); assert.equal(process.env.CLAMAV_HOST, "127.0.0.1");
  assert.equal(process.env.OBJECT_STORE_BUCKET, "ams-recovery-drill");
  assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname, process.env.AMS_RECOVERY_STORAGE_HOST);
  const engine = await readClamAvVersion(), f = await createAccountingFixture(), client = fixtureRpcClient(f);
  const file = new File(["Synthetic authorized private evidence."], "evidence.txt", { type: "text/plain" });
  const hash = createHash("sha256").update(new Uint8Array(await file.arrayBuffer())).digest("hex");
  let writes = 0, reads = 0, intent, draft;
  const store = { async write(...args) { writes++; return writeQuarantinedObject(...args); }, async read(...args) { reads++; return readPrivateObject(...args); } };
  const prepare = async () => {
    const doc = await f.save(f.body("invoice", "1.00"));
    return { doc, upload: await createUploadIntent(client, f.org, { document_id: doc.document_id, filename: file.name, content_type: file.type, byte_size: file.size, sha256: hash }) };
  };
  const deniedWithoutStorage = async (actor, id, input = file) => {
    const before = { writes, reads };
    await assert.rejects(() => completeUpload(fixtureRpcClient(f, actor), f.org, id, input, store), error => ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code));
    assert.deepEqual({ writes, reads }, before);
  };
  try {
    ({ doc: draft, upload: intent } = await prepare());
    await t.test("anonymous, nonmember, another owner, guessed intent and changed metadata cause zero object I/O", async () => {
      for (const actor of ["", f.ids.outsider, f.ids.billing, f.ids.checker]) await deniedWithoutStorage(actor, intent.intent_id);
      await deniedWithoutStorage(f.ids.owner, randomUUID());
      await deniedWithoutStorage(f.ids.owner, intent.intent_id, new File(["Different synthetic bytes"], "evidence.txt", { type: "text/plain" }));
      assert.equal(await readPrivateObject(`${f.org}/attachments/${intent.intent_id}`), null);
      await assert.rejects(() => f.rpc("SELECT finance_private.require_attachment_source_write($1,$2,false)", [f.org, draft.document_id]), e => e.code === "42501");
      await assert.rejects(() => f.rpc("SELECT * FROM finance.attachment_upload_intents WHERE organization_id=$1", [f.org]), e => e.code === "42501");
    });
    await t.test("expired or no-longer-draft upload targets remain unwritable", async () => {
      const expired = await prepare();
      await f.admin.query("UPDATE finance.attachment_upload_intents SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE organization_id=$1 AND id=$2", [f.org, expired.upload.intent_id]);
      await deniedWithoutStorage(f.ids.owner, expired.upload.intent_id);
      const reviewed = await prepare(); assert.equal((await f.submit(reviewed.doc)).state, "approved");
      await deniedWithoutStorage(f.ids.owner, reviewed.upload.intent_id);
    });
    await t.test("authorized upload stays quarantined, real scanning releases it, and replay retains one link/audit", async () => {
      const result = await completeUpload(client, f.org, intent.intent_id, file, store);
      assert.deepEqual(result, { attachment_id: intent.intent_id, scan_status: "pending_scan", downloadable: false });
      await assert.rejects(() => readPrivateArtifact(client, f.org, "attachments", intent.intent_id), e => e.code === "NOT_FOUND");
      await processAttachmentScanBatch(10);
      const row = (await f.admin.query("SELECT scan_status,scan_engine_version FROM finance.attachments WHERE organization_id=$1 AND id=$2", [f.org, intent.intent_id])).rows[0];
      assert.deepEqual(row, { scan_status: "clean", scan_engine_version: engine });
      const replay = await completeUpload(client, f.org, intent.intent_id, file, store);
      assert.deepEqual(replay, { attachment_id: intent.intent_id, scan_status: "clean", downloadable: true });
      const artifact = await readPrivateArtifact(client, f.org, "attachments", intent.intent_id);
      assert.equal(createHash("sha256").update(new Uint8Array(await artifact.bytes.arrayBuffer())).digest("hex"), hash);
      const counts = (await f.admin.query(`SELECT (SELECT count(*)::int FROM finance.attachment_links WHERE organization_id=$1 AND attachment_id=$2) AS links,
        (SELECT count(*)::int FROM finance.audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='attachment.uploaded') AS audits,
        (SELECT count(*)::int FROM finance.journal_entries WHERE organization_id=$1) AS journals`, [f.org, intent.intent_id])).rows[0];
      assert.deepEqual(counts, { links: 1, audits: 1, journals: 0 });
    });
    await t.test("draft library accepts genuine bigint metadata and filters upload days in the company timezone", async () => {
      // Privileged synthetic metadata setup only: no accounting facts change.
      await f.admin.query("UPDATE finance.organizations SET timezone='America/New_York' WHERE id=$1", [f.org]);
      await f.admin.query("UPDATE finance.attachments SET created_at='2026-10-24T01:30:00Z' WHERE organization_id=$1 AND id=$2", [f.org, intent.intent_id]);
      const args = { p_organization_id: f.org, p_search: null, p_from: "2026-10-23", p_to: "2026-10-23", p_offset: 0, p_limit: 50 };
      const listed = await client.rpc("list_evidence_library", args); assert.equal(listed.error, null);
      assert.equal(listed.data.length, 1); const row = parseEvidence(listed.data[0]);
      assert.equal(row.source_date, "2025-01-15"); assert.equal(row.byte_size, file.size); assert.equal(row.scan_status, "clean");
      const absent = await client.rpc("list_evidence_library", { ...args, p_from: "2026-10-24", p_to: "2026-10-24" });
      assert.deepEqual(absent.data, []);
      const foreign = await fixtureRpcClient(f, f.ids.outsider).rpc("list_evidence_library", args); assert.equal(foreign.error.code, "42501");
    });
    await t.test("membership revocation denies completion/replay before storage even with the old actor identity", async () => {
      const member = (await f.admin.query("SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2", [f.org, f.ids.owner])).rows[0].id;
      await f.rpc("SELECT public.deactivate_member($1,$2,$3)", [f.org, member, `upload-revoke-${randomUUID()}`], f.ids.checker);
      await deniedWithoutStorage(f.ids.owner, intent.intent_id);
      await assert.rejects(() => readPrivateArtifact(client, f.org, "attachments", intent.intent_id), e => e.code === "NOT_FOUND");
    });
    console.log(JSON.stringify({ fixture: "authorized-private-upload", organizationId: f.org, engine, deniedStorageWrites: 0, immutableContentDigestVerified: true, externalDelivery: false }));
  } finally { await f.close(); }
});
