import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import { getIssuedInvoicePdf } from "../../apps/web/server/documents/invoice-pdf-storage.ts";

test("issued PDF retrieval with real bigint metadata and restricted authorization", { timeout: 90_000 }, async (t) => {
  assert.equal(process.env.AMS_DATABASE_TESTS, "isolated", "Use the disposable E2E database and synthetic issued-invoice fixture.");
  const { AMS_TEST_USER_EMAIL: email, AMS_TEST_ORGANIZATION_ID: org, AMS_TEST_INVOICE_ID: invoice } = process.env;
  assert.ok(email?.endsWith("@example.invalid") && org && invoice, "Supply the synthetic E2E owner/company/posted invoice.");
  const pool = new Pool({ connectionString: process.env.DATABASE_RUNTIME_URL, max: 1 });
  const db = await pool.connect();
  try {
    const role = (await db.query(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted,
      pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.ok(role.restricted && role.runtime);
    await db.query("BEGIN READ ONLY");
    const user = (await db.query("SELECT id FROM identity.users WHERE email_normalized=$1", [email])).rows[0];
    assert.ok(user);
    const setActor = (id) => db.query("SELECT set_config('ams.actor_user_id',$1,true)", [id]);
    await setActor(user.id);
    const membership = (await db.query("SELECT * FROM public.resolve_active_membership($1)", [org])).rows[0];
    assert.ok(membership, "Fixture owner must have a live membership.");
    let byteCountType;
    const client = { rpc: async (name, args) => {
      await db.query("SAVEPOINT rpc");
      try {
        let result;
        if (name === "read_invoice_pdf_version") {
          result = { data: (await db.query("SELECT public.read_invoice_pdf_version($1,$2) AS value", [args.p_organization_id,args.p_document_id])).rows[0].value, error: null };
        } else if (name === "authorize_artifact_download") {
          const rows = (await db.query("SELECT * FROM public.authorize_artifact_download($1,$2,$3)", [args.p_organization_id,args.p_kind,args.p_artifact_id])).rows;
          byteCountType = typeof rows[0]?.expected_size;
          result = { data: rows, error: null };
        } else throw Error(`Unexpected RPC ${name}: fixture must already have an issued PDF.`);
        await db.query("RELEASE SAVEPOINT rpc");
        return result;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT rpc");
        await db.query("RELEASE SAVEPOINT rpc");
        return { data: null, error: { code: error.code } };
      }
    } };
    const actor = { organizationId: org, capabilities: ["sales.read"] };
    let original;
    await t.test("download and retry return identical issued bytes without registering another version", async () => {
      original = await getIssuedInvoicePdf(client, actor, invoice);
      assert.equal(byteCountType, "string", "Exercise the actual PostgreSQL bigint transport.");
      assert.equal(original.bytes.subarray(0,5).toString(), "%PDF-");
      assert.ok(original.bytes.length > 1000);
      const retry = await getIssuedInvoicePdf(client, actor, invoice);
      assert.equal(retry.pdfId, original.pdfId);
      assert.deepEqual(retry.bytes, original.bytes);
    });
    await t.test("missing capability, foreign company, anonymous and nonmember identities cannot download", async () => {
      await assert.rejects(() => getIssuedInvoicePdf(client, { ...actor, capabilities: [] }, invoice));
      await assert.rejects(() => getIssuedInvoicePdf(client, { ...actor, organizationId: randomUUID() }, invoice));
      for (const id of ["", randomUUID()]) {
        await setActor(id);
        await assert.rejects(() => getIssuedInvoicePdf(client, actor, invoice));
      }
      await setActor(user.id);
    });
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
    await pool.end();
  }
});
