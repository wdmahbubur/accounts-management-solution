import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {Pool} from '@neondatabase/serverless';
import '../../scripts/load-local-env.mjs';

test('restricted worker claims issued invoice delivery without output-column ambiguity', {timeout:90000}, async t=>{
  assert.equal(process.env.AMS_DATABASE_TESTS,'isolated');
  const target=new URL(process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL);
  assert.equal(target.hostname,process.env.AMS_TEST_DATABASE_HOST);
  assert.notEqual(target.hostname,'ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech');
  assert.equal(new URL(process.env.DATABASE_RUNTIME_URL).hostname,target.hostname);
  const workerUrl=new URL(process.env.DATABASE_WORKER_URL);
  assert.equal(decodeURIComponent(workerUrl.username),'ams_job_worker_login');
  workerUrl.hostname=target.hostname;workerUrl.pathname=target.pathname;
  const owner=new Pool({connectionString:target.toString(),max:1});
  const runtime=new Pool({connectionString:process.env.DATABASE_RUNTIME_URL,max:1});
  const worker=new Pool({connectionString:workerUrl.toString(),max:1});
  let c;
  const tables=['business_documents','journal_entries','journal_lines','open_items','settlement_allocations','invoice_pdf_versions'];
  async function facts(){const result={};for(const table of tables)result[table]=(await owner.query(`SELECT count(*)::int AS rows,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS fingerprint FROM finance.${table} t`)).rows[0];return result;}
  try{
    const fixture=(await owner.query(`SELECT d.id AS document_id,d.organization_id,u.id AS user_id,f.id AS pdf_id,f.sha256
      FROM finance.business_documents d JOIN finance.invoice_pdf_versions f ON f.organization_id=d.organization_id AND f.document_id=d.id AND f.source_document_version=d.version
      JOIN finance.organizations o ON o.id=d.organization_id AND o.name LIKE 'E2E%'
      JOIN finance.organization_members m ON m.organization_id=d.organization_id AND m.status='active'
      JOIN identity.users u ON u.id=m.user_id AND u.email_normalized=$1
      WHERE d.state='posted' AND d.document_type='invoice' AND d.party_snapshot->>'email' LIKE '%@example.invalid'
      ORDER BY f.created_at DESC LIMIT 1`,['e2e-20261020-1550@example.invalid'])).rows[0];
    assert.ok(fixture,'Requires an existing synthetic issued invoice and PDF in the disposable database.');
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
  }finally{if(c){await c.query('ROLLBACK').catch(()=>{});c.release();}await Promise.all([owner.end(),runtime.end(),worker.end()]);}
});
