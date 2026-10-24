import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import {createAccountingFixture} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {createUploadIntent,completeUpload} from '../../apps/web/server/artifacts/uploads.ts';
import {processAttachmentScanBatch} from '../../apps/web/server/artifacts/scanner-worker.ts';
import {readClamAvVersion} from '../../apps/web/server/artifacts/clamav.ts';
import {readPrivateArtifact} from '../../apps/web/server/artifacts/download.ts';
test('maintained ClamAV scans real private uploads and keeps infected/unscanned objects quarantined',{timeout:300_000},async t=>{
 assert.equal(process.env.AMS_SCANNER_TESTS,'real-clamav');assert.equal(process.env.CLAMAV_HOST,'127.0.0.1');assert.equal(process.env.OBJECT_STORE_BUCKET,'ams-recovery-drill');assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname,process.env.AMS_RECOVERY_STORAGE_HOST);
 const engine=await readClamAvVersion();assert.match(engine,/^ClamAV-1\.[0-9.]+-db[1-9][0-9]*$/);
 const f=await createAccountingFixture(),client=fixtureRpcClient(f);let clean,infected;
 const bytes=new TextEncoder().encode('Synthetic clean accounting evidence.');
 const upload=async(content,name='evidence.txt',type='text/plain')=>{const doc=await f.save(f.body('invoice','1.00'));const intent=await createUploadIntent(client,f.org,{document_id:doc.document_id,filename:name,content_type:type,byte_size:content.length,sha256:createHash('sha256').update(content).digest('hex')});const result=await completeUpload(client,f.org,intent.intent_id,new File([content],name,{type}));assert.equal(result.scan_status,'pending_scan');return intent.intent_id;};
 try{
  await t.test('S-16 content-type spoof and unsafe names fail before object registration',async()=>{
   for(const filename of['../bad.txt','C:\\bad.txt','bad\u0000.txt'])await assert.rejects(()=>createUploadIntent(client,f.org,{document_id:randomUUID(),filename,content_type:'text/plain',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}),e=>e.code==='VALIDATION_FAILED');
   await assert.rejects(()=>completeUpload(client,f.org,randomUUID(),new File([bytes],'spoof.pdf',{type:'application/pdf'})),e=>e.code==='VALIDATION_FAILED');
  });
  await t.test('S-16 uploaded clean and EICAR test bytes remain unavailable before a real engine decision',async()=>{
   clean=await upload(bytes);const eicar=['X5O!P%@AP[4\\PZX54(P^)7CC)7}','$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join('');infected=await upload(new TextEncoder().encode(eicar),'scanner-test.txt');
   for(const id of[clean,infected])await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',id),e=>e.code==='NOT_FOUND');
  });
  await t.test('actual worker records engine/signature revision; clean downloads and infected objects remain denied',async()=>{
   const result=await processAttachmentScanBatch(10);assert.ok(result.resolved>=2,JSON.stringify(result));
   const rows=(await f.admin.query('SELECT id,scan_status,scan_engine_version,scan_attempt_count FROM finance.attachments WHERE organization_id=$1 ORDER BY id',[f.org])).rows;
   assert.equal(rows.find(r=>r.id===clean).scan_status,'clean');assert.equal(rows.find(r=>r.id===infected).scan_status,'rejected');assert.ok(rows.every(r=>r.scan_engine_version===engine&&r.scan_attempt_count===1));
   const artifact=await readPrivateArtifact(client,f.org,'attachments',clean);assert.deepEqual(Buffer.from(await artifact.bytes.arrayBuffer()),Buffer.from(bytes));
   await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',infected),e=>e.code==='NOT_FOUND');
   await assert.rejects(()=>readPrivateArtifact(fixtureRpcClient(f,f.ids.outsider),f.org,'attachments',clean),e=>e.code==='NOT_FOUND');
   await assert.rejects(()=>f.rpc('SELECT finance_private.claim_attachment_scans(1,300)'),e=>e.code==='42501');
  });
  await t.test('scanner outage queues a bounded retry and cannot label an unscanned object clean',async()=>{
   const pending=await upload(bytes,'retry-evidence.txt'),port=process.env.CLAMAV_PORT;process.env.CLAMAV_PORT='65534';
   try{const result=await processAttachmentScanBatch(10);assert.ok(result.retry_queued>=1,JSON.stringify(result));}finally{process.env.CLAMAV_PORT=port;}
   const row=(await f.admin.query('SELECT scan_status,scan_error_code,scan_attempt_count,scan_available_at>now() AS backoff,scan_lease_token FROM finance.attachments WHERE id=$1',[pending])).rows[0];
   assert.deepEqual(row,{scan_status:'pending',scan_error_code:'CLAMAV_UNAVAILABLE',scan_attempt_count:1,backoff:true,scan_lease_token:null});
   await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',pending),e=>e.code==='NOT_FOUND');
  });
  console.log(JSON.stringify({fixture:'real-clamav',organizationId:f.org,engine,cleanAttachment:clean,rejectedTestAttachment:infected,realPrivateObjectStorage:true,financialPosting:false}));
 }finally{await f.close();}
});
