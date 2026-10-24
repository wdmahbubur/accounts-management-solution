import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { isolatedRecoveryUrl } from "../../scripts/recovery-database.mjs";
import { getIssuedInvoicePdf } from "../../apps/web/server/documents/invoice-pdf-storage.ts";
import { readPrivateArtifact } from "../../apps/web/server/artifacts/download.ts";
import { readPrivateObject } from "../../apps/web/server/storage/private.ts";

test("private file restore, corruption detection and live access after database recovery", { timeout: 180_000 }, async t => {
  const ownerUrl = isolatedRecoveryUrl(process.env.DATABASE_URL, process.env.AMS_TEST_DATABASE_HOST);
  assert.notEqual(ownerUrl.hostname, process.env.AMS_RECOVERY_SOURCE_HOST, "Use the restored target, not the backup source.");
  const runtimeUrl = isolatedRecoveryUrl(process.env.DATABASE_RUNTIME_URL, process.env.AMS_TEST_DATABASE_HOST);
  assert.equal(runtimeUrl.pathname, ownerUrl.pathname);
  const endpoint = new URL(process.env.OBJECT_STORE_ENDPOINT);
  assert.ok(process.env.AMS_RECOVERY_STORAGE_HOST);
  assert.equal(endpoint.hostname, process.env.AMS_RECOVERY_STORAGE_HOST);
  assert.equal(endpoint.protocol, "https:");
  assert.notEqual(endpoint.hostname, "br-delicate-smoke-b4ilnfwr.storage.c-6.us-east-2.aws.neon.tech");
  assert.equal(process.env.OBJECT_STORE_BUCKET, "ams-recovery-drill");
  assert.ok(process.env.AMS_RECOVERY_MANIFEST && process.env.AMS_RECOVERY_BACKUP_DIR);
  const manifest = JSON.parse(await readFile(process.env.AMS_RECOVERY_MANIFEST, "utf8"));
  assert.equal(manifest.objects.pdfs.length, 1, "This drill selects the known synthetic PDF baseline.");
  const pdf = manifest.objects.pdfs[0];
  assert.equal(pdf.object_key, `${pdf.organization_id}/invoice-pdfs/${pdf.id}`);
  assert.match(pdf.organization_id, /^[0-9a-f-]{36}$/);
  assert.match(pdf.id, /^[0-9a-f-]{36}$/);
  const bytes = await readFile(resolve(".local-private-objects", ...pdf.object_key.split("/")));
  const digest = value => createHash("sha256").update(value).digest("hex");
  assert.equal(digest(bytes), pdf.sha256);
  assert.equal(String(bytes.length), pdf.byte_size);
  const directory = resolve(process.env.AMS_RECOVERY_BACKUP_DIR);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const backupFile = resolve(directory, `${pdf.sha256}.pdf`);
  await writeFile(backupFile, bytes, { flag: "wx", mode: 0o600 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const backup = await readFile(backupFile);
  assert.deepEqual(backup, bytes, "Independent object bytes must match the immutable database digest.");

  const admin = new Pool({ connectionString: ownerUrl.toString(), max: 1 });
  const runtime = new Pool({ connectionString: runtimeUrl.toString(), max: 1 });
  const s3 = new S3Client({ endpoint: endpoint.toString(), region: process.env.AWS_REGION, forcePathStyle: true });
  const bucket = process.env.OBJECT_STORE_BUCKET;
  let currentActor = "";
  const call = async (sql, args = [], readOnly = true) => {
    const db = await runtime.connect();
    try {
      await db.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
      await db.query("SELECT set_config('ams.actor_user_id',$1,true)", [currentActor]);
      const result = await db.query(sql, args);
      await db.query("COMMIT"); return result;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
    finally { db.release(); }
  };
  const client = { rpc: async (name, args) => {
    try {
      if (name === "read_invoice_pdf_version") return { data: (await call("SELECT public.read_invoice_pdf_version($1,$2) AS value", [args.p_organization_id, args.p_document_id])).rows[0].value, error: null };
      assert.equal(name, "authorize_artifact_download");
      return { data: (await call("SELECT * FROM public.authorize_artifact_download($1,$2,$3)", [args.p_organization_id, args.p_kind, args.p_artifact_id])).rows, error: null };
    } catch (error) { return { data: null, error: { code: error.code } }; }
  } };
  const actor = { organizationId: pdf.organization_id, capabilities: ["sales.read"] };
  const download = () => getIssuedInvoicePdf(client, actor, pdf.document_id);
  const put = (value, missingOnly = true) => s3.send(new PutObjectCommand({ Bucket: bucket, Key: pdf.object_key,
    Body: value, ContentType: "application/pdf", ...(missingOnly ? { IfNoneMatch: "*" } : {}) }));
  const remove = () => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: pdf.object_key }));
  async function financialFacts() {
    const facts = {};
    for (const table of ["business_documents", "journal_entries", "journal_lines", "money_movements", "open_items", "settlement_allocations", "invoice_pdf_versions"]) {
      facts[table] = (await admin.query(`SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint
        FROM finance.${table} t WHERE organization_id=$1`, [pdf.organization_id])).rows[0];
    }
    return facts;
  }
  try {
    const owner = (await admin.query(`SELECT m.user_id,m.id FROM finance.organization_members m
      JOIN finance.member_roles mr ON mr.organization_id=m.organization_id AND mr.member_id=m.id
      JOIN finance.roles r ON r.organization_id=mr.organization_id AND r.id=mr.role_id
      JOIN identity.users u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.status='active' AND r.template_key='owner'
      AND u.email_normalized LIKE '%@example.invalid' ORDER BY m.id LIMIT 1`, [pdf.organization_id])).rows[0];
    assert.ok(owner, "A synthetic owner of the restored PDF company is required.");
    currentActor = owner.user_id;
    const role = (await call(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted,
      pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime,has_table_privilege(current_user,'finance.journal_lines','INSERT') AS ledger_write
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.deepEqual(role, { restricted: true, runtime: true, ledger_write: false });
    const before = await financialFacts();

    await t.test("database-only restoration cannot serve a missing private object", async () => {
      await remove();
      await assert.rejects(download, error => error.code === "NOT_FOUND");
    });
    await t.test("restore independently backed-up bytes to private provider storage", async () => {
      await put(backup);
      const restored = await download();
      assert.equal(restored.pdfId, pdf.id);
      assert.deepEqual(restored.bytes, backup);
      assert.equal(digest(restored.bytes), pdf.sha256);
    });
    await t.test("the restored provider object cannot be fetched without a signature", async () => {
      const response = await fetch(new URL(`/${bucket}/${pdf.object_key}`, endpoint), { redirect: "manual" });
      await response.body?.cancel();
      assert.ok([403, 404].includes(response.status), "An unsigned object request must be denied.");
    });
    await t.test("actual provider corruption is rejected and original bytes can be recovered", async () => {
      await put(Buffer.from("%PDF-corrupt recovery drill fixture"), false);
      try { await assert.rejects(download, error => error.code === "NOT_FOUND"); }
      finally { await remove(); await put(backup); }
      const recovered = await download();
      assert.deepEqual(recovered.bytes, backup);
      assert.equal((await download()).pdfId, recovered.pdfId);
    });
    await t.test("foreign-company, anonymous, nonmember and missing-capability access is denied", async () => {
      await assert.rejects(() => getIssuedInvoicePdf(client, { ...actor, capabilities: [] }, pdf.document_id));
      await assert.rejects(() => getIssuedInvoicePdf(client, { ...actor, organizationId: randomUUID() }, pdf.document_id));
      for (const id of ["", randomUUID()]) { currentActor = id; await assert.rejects(download); }
      currentActor = owner.user_id;
      assert.equal(await readPrivateObject("../outside"), null);
    });
    await t.test("membership revocation is enforced with the same authenticated actor", async () => {
      const user = randomUUID(), member = randomUUID(), roleId = randomUUID();
      // New identity/membership fixtures only. All reads use the actual restricted login.
      await admin.query("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,'Recovery reader','$argon2id$non-login-fixture',now())", [user, `recovery-${user}@example.invalid`]);
      await admin.query("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,'Recovery reader')", [member, pdf.organization_id, user]);
      await admin.query("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)", [roleId, pdf.organization_id, `Recovery ${roleId}`]);
      await admin.query("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code='sales.read'", [pdf.organization_id, roleId]);
      await admin.query("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)", [pdf.organization_id, member, roleId]);
      currentActor = user;
      assert.deepEqual((await download()).bytes, backup);
      await admin.query(`INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at)
        SELECT $1,id,session_version,now(),now()+interval '1 hour' FROM identity.users WHERE id=$2`, [randomUUID(), owner.user_id]);
      currentActor = owner.user_id;
      await call("SELECT public.deactivate_member($1,$2,$3)", [pdf.organization_id, member, `recovery-revoke-${randomUUID()}`], false);
      currentActor = user;
      await assert.rejects(download);
      currentActor = owner.user_id;
    });
    await t.test("quarantined bytes remain unavailable after recovery", async () => {
      const attachment = randomUUID(), key = `${pdf.organization_id}/attachments/${attachment}`;
      // A pending metadata fixture checks the actual download guard, not an antivirus scan.
      await admin.query("INSERT INTO finance.attachments(id,organization_id,object_key,original_filename,content_type,byte_size,sha256,scan_status,uploaded_by_member_id) VALUES($1,$2,$3,'recovery.pdf','application/pdf',$4,$5,'pending',$6)", [attachment, pdf.organization_id, key, bytes.length, pdf.sha256, owner.id]);
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: backup, ContentType: "application/pdf", IfNoneMatch: "*" }));
      let requestedBytes = false;
      await assert.rejects(() => readPrivateArtifact(client, pdf.organization_id, "attachments", attachment,
        async () => { requestedBytes = true; return backup; }));
      assert.equal(requestedBytes, false, "Quarantine denial must occur before any storage read.");
    });
    assert.deepEqual(await financialFacts(), before, "Recovery and denied requests must not change posted facts or issued metadata.");
  } finally {
    s3.destroy(); await runtime.end(); await admin.end();
  }
});
