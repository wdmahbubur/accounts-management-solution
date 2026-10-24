import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from '@neondatabase/serverless';
import '../../scripts/load-local-env.mjs';
import {createAccountingFixture} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {getIssuedInvoicePdf} from '../../apps/web/server/documents/invoice-pdf-storage.ts';

test('restricted worker claims issued invoice delivery without output-column ambiguity', {timeout:180000}, async t=>{
  assert.equal(process.env.AMS_DATABASE_TESTS,'isolated');
  const target=new URL(process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL);
  assert.equal(target.hostname,process.env.AMS_TEST_DATABASE_HOST);
  assert.notEqual(target.hostname,'ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech');
  assert.equal(new URL(process.env.DATABASE_RUNTIME_URL).hostname,target.hostname);
  const workerUrl=new URL(process.env.DATABASE_WORKER_URL);
  assert.equal(decodeURIComponent(workerUrl.username),'ams_job_worker_login');
  assert.equal(workerUrl.hostname,target.hostname);assert.equal(workerUrl.pathname,target.pathname);
  assert.equal(process.env.OBJECT_STORE_BUCKET,'ams-recovery-drill');
  assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname,process.env.AMS_RECOVERY_STORAGE_HOST);
  const f=await createAccountingFixture();const owner=f.admin,runtime=f.runtime;
  const worker=new Pool({connectionString:workerUrl.toString(),max:1});
  let c;
  const tables=['business_documents','journal_entries','journal_lines','open_items','settlement_allocations','invoice_pdf_versions'];
  async function facts(){const result={};for(const table of tables)result[table]=(await owner.query(`SELECT count(*)::int AS rows,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint FROM finance.${table} t WHERE organization_id=$1`,[f.org])).rows[0];return result;}
  try{
    // Unique evidence through actual posting/PDF services, without a required
    // historical browser account or a manufactured issued-PDF database row.
    await owner.query("UPDATE finance.contacts SET email='outbox-claim@example.invalid' WHERE organization_id=$1 AND id=$2",[f.org,f.contacts.customer]);
    const doc=await f.posted(f.body('invoice','10.00'));
    const pdf=await getIssuedInvoicePdf(fixtureRpcClient(f),{organizationId:f.org,capabilities:['sales.read']},doc.document_id);
    const fixture={document_id:doc.document_id,organization_id:f.org,user_id:f.ids.owner,pdf_id:pdf.pdfId,sha256:createHash('sha256').update(pdf.bytes).digest('hex')};
    const before=await facts();
    const runtimeClient=await runtime.connect();let event;
    try{
      await runtimeClient.query('BEGIN');
      await runtimeClient.query("SELECT set_config('ams.actor_user_id',$1,true)",[fixture.user_id]);
      event=(await runtimeClient.query('SELECT public.request_invoice_email_delivery($1,$2,$3,$4) AS result',
        [fixture.organization_id,fixture.document_id,fixture.pdf_id,randomUUID()])).rows[0].result;
      await runtimeClient.query('COMMIT');
      await t.test('ordinary request role cannot claim worker leases',async()=>{
        await assert.rejects(runtimeClient.query('SELECT * FROM finance_private.claim_outbox_batch($1,1,120)',[['document.send_requested']]),{code:'42501'});
      });
    }finally{await runtimeClient.query('ROLLBACK').catch(()=>{});runtimeClient.release();}
    c=await worker.connect();
    const role=(await c.query(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.ok(role.restricted);
    await c.query('BEGIN');
    const claims=(await c.query('SELECT * FROM finance_private.claim_outbox_batch($1,25,120)',[['document.send_requested']])).rows;
    const claimed=claims.find(row=>row.event_id===event.outbox_event_id);assert.ok(claimed);
    assert.equal(claimed.organization_id,fixture.organization_id);assert.equal(claimed.document_id,fixture.document_id);
    const invoice=(await c.query('SELECT * FROM finance_private.read_claimed_invoice_delivery($1,$2)',[claimed.event_id,claimed.lease_token])).rows[0];
    assert.equal(invoice.pdf_version_id,fixture.pdf_id);assert.equal(invoice.sha256,fixture.sha256);
    await t.test('wrong lease cannot read invoice delivery metadata',async()=>{
      await c.query('SAVEPOINT wrong_lease');
      await assert.rejects(c.query('SELECT * FROM finance_private.read_claimed_invoice_delivery($1,$2)',[claimed.event_id,randomUUID()]),{code:'40001'});
      await c.query('ROLLBACK TO SAVEPOINT wrong_lease');
    });
    await t.test('completion is fenced and no email or financial posting is performed by this test',async()=>{
      await c.query('SELECT finance_private.complete_outbox_delivery($1,$2,$3)',[claimed.event_id,claimed.lease_token,'database-test-not-a-real-email']);
      await c.query('SAVEPOINT completed_lease');
      await assert.rejects(c.query('SELECT * FROM finance_private.read_claimed_invoice_delivery($1,$2)',[claimed.event_id,claimed.lease_token]),{code:'40001'});
      await c.query('ROLLBACK TO SAVEPOINT completed_lease');
    });
    await c.query('ROLLBACK');
    assert.deepEqual(await facts(),before);
  }finally{if(c){await c.query('ROLLBACK').catch(()=>{});c.release();}await Promise.all([f.close(),worker.end()]);}
});
