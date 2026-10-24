import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createAccountingFixture, request } from "./helpers/accounting-fixture.mjs";
import { fixtureRpcClient } from "./helpers/rpc-client.mjs";
import { getIssuedInvoicePdf } from "../../apps/web/server/documents/invoice-pdf-storage.ts";

test("T-49 issued invoice and PDF retain original customer and tax snapshots", { timeout: 180_000 }, async () => {
  const f = await createAccountingFixture(), client = fixtureRpcClient(f), actor = { organizationId: f.org, capabilities: ["sales.read"] };
  assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname, process.env.AMS_RECOVERY_STORAGE_HOST);
  assert.equal(process.env.OBJECT_STORE_BUCKET, "ams-recovery-drill");
  const digest = bytes => createHash("sha256").update(bytes).digest("hex");
  try {
    const first = (await f.rpc("SELECT * FROM public.create_tax_code_version($1,$2,'Synthetic illustrative rates only','SNAPSHOT10','Original illustrative ten percent',10,'standard',$3,$4,'full','2025-01-01'::date,NULL,0)", [f.org, request("tax original").id, f.accounts["2100"], f.accounts["1200"]])).rows[0];
    const doc = await f.posted(f.body("invoice", "100.00", { lines: [{ ...f.line("100.00"), tax_code_id: first.tax_code_id }] }));
    const read = async () => { const result = await client.rpc("read_financial_document", { p_organization_id: f.org, p_document_id: doc.document_id }); assert.equal(result.error, null); return result.data; };
    const before = await read(), issued = await getIssuedInvoicePdf(client, actor, doc.document_id);
    const contact = (await f.admin.query("SELECT row_version FROM finance.contacts WHERE organization_id=$1 AND id=$2", [f.org, f.contacts.customer])).rows[0];
    const m = request("change customer");
    await f.rpc("SELECT public.save_contact($1,$2,$3,$4,$5,$6,$7::jsonb)", [f.org, f.contacts.customer, contact.row_version, m.id, m.key, m.hash, JSON.stringify({ display_name: "Changed synthetic customer", is_customer: true, is_vendor: false, email: "changed-snapshot@example.invalid", payment_terms_days: 0, credit_limit: null, billing_address: {}, tax_identifiers: {}, is_active: true })]);
    await f.rpc("SELECT * FROM public.create_tax_code_version($1,$2,'Synthetic illustrative rates only','SNAPSHOT10','Replacement illustrative twenty percent',20,'standard',$3,$4,'full','2025-02-01'::date,NULL,$5)", [f.org, request("tax replacement").id, f.accounts["2100"], f.accounts["1200"], first.row_version]);
    const after = await read(), retained = await getIssuedInvoicePdf(client, actor, doc.document_id);
    assert.deepEqual(after, before); assert.equal(retained.pdfId, issued.pdfId); assert.equal(digest(retained.bytes), digest(issued.bytes));
    assert.equal(after.party_snapshot.display_name, "Synthetic customer"); assert.match(after.lines[0].tax_rate_snapshot, /^10(?:\.0+)?$/);
    console.log(JSON.stringify({ fixture: "issued-snapshot", organizationId: f.org, pdfId: retained.pdfId, checksumVerified: true }));
  } finally { await f.close(); }
});
