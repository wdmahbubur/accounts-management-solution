import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Pool} from '@neondatabase/serverless';
import test from 'node:test';
import {createAccountingFixture} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {createUploadIntent,completeUpload} from '../../apps/web/server/artifacts/uploads.ts';
import {readPrivateArtifact} from '../../apps/web/server/artifacts/download.ts';

test('cloud scan checkpoints and deferrals remain organization-, digest- and lease-fenced',{timeout:240000},async t=>{
 const f=await createAccountingFixture(),worker=new Pool({connectionString:process.env.DATABASE_WORKER_URL,max:1}),client=fixtureRpcClient(f);
 const upload=async()=>{const doc=await f.save(f.body('invoice','1.00')),bytes=new TextEncoder().encode('Synthetic checkpoint evidence'),sha=createHash('sha256').update(bytes).digest('hex');const intent=await createUploadIntent(client,f.org,{document_id:doc.document_id,filename:'checkpoint.txt',content_type:'text/plain',byte_size:bytes.length,sha256:sha});await completeUpload(client,f.org,intent.intent_id,new File([bytes],'checkpoint.txt',{type:'text/plain'}));return{id:intent.intent_id,sha};};
 const begin='SELECT finance_private.begin_attachment_provider_scan($1,$2,$3,$4,$5) AS value',record='SELECT finance_private.record_attachment_provider_scan($1,$2,$3,$4,$5,$6) AS value',abandon='SELECT finance_private.abandon_unsubmitted_attachment_scan($1,$2,$3,$4,$5) AS value';
 const args=(a,c)=>[f.org,a.id,c.lease_token,'bouncer',a.sha];
 const claim=async id=>{
  // Prioritize only this synthetic job; never lease unrelated fixture work.
  await f.admin.query("UPDATE finance.attachments SET scan_available_at='1970-01-01' WHERE organization_id=$1 AND id=$2",[f.org,id]);
  const r=(await worker.query('SELECT * FROM finance_private.claim_attachment_scans(1,300)')).rows;const c=r.find(x=>x.attachment_id===id);assert.ok(c);return c;
 };
 const ready=async id=>f.admin.query("UPDATE finance.attachments SET scan_available_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2 AND scan_status='pending'",[f.org,id]);
 try{
  const role=(await worker.query("SELECT current_user,NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted FROM pg_roles WHERE rolname=current_user")).rows[0];assert.equal(role.current_user,'ams_job_worker_login');assert.equal(role.restricted,true);
  const a=await upload(),c=await claim(a.id),params=args(a,c),remote='scan_'+randomUUID().replaceAll('-','');
  await t.test('ordinary runtime and worker direct DML cannot read/write the private checkpoint table',async()=>{
   await assert.rejects(()=>f.rpc(begin,params),e=>e.code==='42501');
   await assert.rejects(()=>f.rpc('SELECT * FROM finance_private.attachment_provider_scans'),e=>e.code==='42501');
   await assert.rejects(()=>worker.query('SELECT * FROM finance_private.attachment_provider_scans'),e=>e.code==='42501');
   await assert.rejects(()=>worker.query("UPDATE finance.attachments SET scan_status='clean' WHERE id=$1",[a.id]),e=>e.code==='42501');
  });
  await t.test('correct claim can reserve once and persist one immutable provider id',async()=>{
   assert.equal((await worker.query(begin,params)).rows[0].value.created,true);
   assert.equal((await worker.query(begin,params)).rows[0].value.created,false);
   assert.equal((await worker.query(record,[...params,remote])).rows[0].value,true);
   assert.equal((await worker.query(record,[...params,remote])).rows[0].value,true);
   assert.equal((await worker.query(record,[...params,'scan_'+randomUUID().replaceAll('-','')])).rows[0].value,false);
   assert.equal((await worker.query(abandon,params)).rows[0].value,false);
  });
  await t.test('wrong tenant, digest, lease or provider cannot reserve or alter a reference',async()=>{
   for(const p of [[randomUUID(),...params.slice(1)],[...params.slice(0,2),randomUUID(),...params.slice(3)],[...params.slice(0,4),'0'.repeat(64)]]){
    await assert.rejects(()=>worker.query(begin,p),e=>e.code==='55000');assert.equal((await worker.query(record,[...p,remote])).rows[0].value,false);
   }
   await assert.rejects(()=>worker.query(begin,[...params.slice(0,3),'unapproved',params[4]]),e=>e.code==='22023');
  });
  await t.test('pending result keeps quarantine, preserves retry budget and resumes the same remote id',async()=>{
   assert.equal((await worker.query("SELECT finance_private.fail_attachment_scan($1,$2,$3,'SCAN_PENDING') AS value",params.slice(0,3))).rows[0].value,true);
   const row=(await f.admin.query('SELECT scan_status,scan_attempt_count,scan_available_at>now() AS backoff FROM finance.attachments WHERE id=$1',[a.id])).rows[0];assert.deepEqual(row,{scan_status:'pending',scan_attempt_count:0,backoff:true});
   await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',a.id),e=>e.code==='NOT_FOUND');
   await ready(a.id);const next=await claim(a.id),reference=(await worker.query(begin,args(a,next))).rows[0].value;assert.equal(reference.remote_id,remote);assert.equal(reference.created,false);
   assert.equal((await worker.query(record,[...params,remote])).rows[0].value,false,'Old lease is fenced after reclaim.');
   await worker.query("SELECT finance_private.fail_attachment_scan($1,$2,$3,'SCAN_QUOTA_EXCEEDED')",args(a,next).slice(0,3));
  });
  await t.test('quota deferral waits for the next UTC month without exhausting retries or releasing bytes',async()=>{
   const row=(await f.admin.query("SELECT scan_status,scan_attempt_count,scan_error_code,scan_available_at=((date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC')+interval '60 seconds' AS reset FROM finance.attachments WHERE id=$1",[a.id])).rows[0];
   assert.deepEqual(row,{scan_status:'pending',scan_attempt_count:0,scan_error_code:'SCAN_QUOTA_EXCEEDED',reset:true});await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',a.id),e=>e.code==='NOT_FOUND');
  });
  await t.test('only a definitely unsubmitted reservation can be released for a later attempt',async()=>{
   const b=await upload(),cb=await claim(b.id),p=args(b,cb);await worker.query(begin,p);assert.equal((await worker.query(abandon,p)).rows[0].value,true);assert.equal((await worker.query(begin,p)).rows[0].value.created,true);
   await worker.query("SELECT finance_private.fail_attachment_scan($1,$2,$3,'SCAN_SUBMISSION_UNCONFIRMED')",p.slice(0,3));
   await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',b.id),e=>e.code==='NOT_FOUND');
  });
  console.log(JSON.stringify({fixture:'scan-provider-fences',organizationId:f.org,restrictedWorker:true,quarantinePreserved:true}));
 }finally{
  // Keep negative-case evidence quarantined, outside the next real-provider run.
  await f.admin.query("UPDATE finance.attachments SET scan_available_at=now()+interval '1 year',scan_lease_token=NULL,scan_lease_until=NULL WHERE organization_id=$1 AND scan_status='pending'",[f.org]);
  await Promise.all([f.close(),worker.end()]);
 }
});
