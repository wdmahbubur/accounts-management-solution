import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createAccountingFixture,request} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {getIssuedInvoicePdf} from '../../apps/web/server/documents/invoice-pdf-storage.ts';
import {createUploadIntent,completeUpload} from '../../apps/web/server/artifacts/uploads.ts';
import {readPrivateArtifact} from '../../apps/web/server/artifacts/download.ts';
import {readPrivateObject} from '../../apps/web/server/storage/private.ts';
const exec=promisify(execFile);
async function docker(args){return(await exec('docker',args,{timeout:300000,maxBuffer:1024*1024})).stdout.trim();}

test('real Linux job containers deliver, render, scan and schedule with only restricted worker credentials',{timeout:600000},async t=>{
 assert.equal(process.env.AMS_JOB_TESTS,'isolated-docker');const image=process.env.AMS_JOBS_TEST_IMAGE,clamImage=process.env.AMS_CLAMAV_TEST_IMAGE;assert.match(image??'',/^ams-jobs:[a-z0-9-]+$/);assert.match(clamImage??'',/^ams-clamav:[a-z0-9-]+$/);
 assert.equal(process.env.OBJECT_STORE_BUCKET,'ams-recovery-drill');assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname,process.env.AMS_RECOVERY_STORAGE_HOST);
 const f=await createAccountingFixture(),client=fixtureRpcClient(f),token=randomUUID(),network=`ams-test-${token}`,smtp=`ams-test-smtp-${token}`,clam=`ams-test-clam-${token}`,containers=[];
 const directory=resolve('output','worker-tests',token);await mkdir(directory,{recursive:true,mode:0o700});
 const target=new URL(process.env.DATABASE_RUNTIME_URL);target.username='';target.password='';target.search='';target.hash='';
 const common={NODE_ENV:'production',DATABASE_WORKER_URL:process.env.DATABASE_WORKER_URL,DATABASE_WORKER_TARGET_URL:target.toString()};
 const storage=Object.fromEntries(['OBJECT_STORE_BUCKET','OBJECT_STORE_ENDPOINT','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
 async function run(kind,extra={}){
  const name=`ams-test-${kind}-${token}`;containers.push(name);const file=join(directory,`${kind}.env`),values={...common,...(['mail','scanner','exports'].includes(kind)?storage:{}),...extra};
  assert.ok(Object.values(values).every(value=>typeof value==='string'&&!/[\r\n\0]/.test(value)));
  await writeFile(file,Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
  const output=await docker(['run','--name',name,'--network',network,'--memory',kind==='exports'?'768m':'256m','--cpus','0.5','--pids-limit','128','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,noexec,size=64m,mode=1777','--mount',`type=bind,source=${file},target=/run/secrets/worker_env,readonly`,image,kind,'--once']);
  const inspected=JSON.parse(await docker(['inspect',name]))[0];assert.equal(inspected.State.ExitCode,0,output);assert.equal(inspected.State.OOMKilled,false);assert.equal(inspected.Config.User,'node');assert.ok(inspected.Config.Env.every(value=>!/(DATABASE|SMTP|AWS_ACCESS|AWS_SECRET|INVITATION)/.test(value)));assert.equal(inspected.HostConfig.ReadonlyRootfs,true);assert.ok(inspected.HostConfig.CapDrop.includes('ALL'));assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);assert.deepEqual(Object.keys(inspected.NetworkSettings.Networks),[network]);
  const events=output.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));assert.equal(events.filter(event=>event.event==='worker.batch_complete').length,1,output);assert.equal(events.some(event=>event.event==='worker.batch_failed'),false,output);return events.find(event=>event.event==='worker.batch_complete').result;
 }
 try{
  const queue=(await f.admin.query("SELECT (SELECT count(*) FROM finance.attachments WHERE scan_status='pending')::int AS scans,(SELECT count(*) FROM finance.export_jobs WHERE status IN ('queued','processing'))::int AS exports,(SELECT count(*) FROM finance.outbox_events WHERE event_type IN ('invitation.send','document.send_requested','financial.reminder') AND status IN ('pending','processing'))::int AS mail")).rows[0];assert.deepEqual(queue,{scans:0,exports:0,mail:0},'Use an isolated database with no competing delivery/export/scan jobs.');
  await docker(['network','create',network]);
  containers.push(smtp);await docker(['run','-d','--name',smtp,'--network',network,'--network-alias','smtp-fixture','--read-only','--cap-drop','ALL','--memory','128m','--mount',`type=bind,source=${resolve('tests/database/helpers/container-smtp.mjs')},target=/fixture.mjs,readonly`,'--entrypoint','node',image,'/fixture.mjs']);
  containers.push(clam);await docker(['run','-d','--rm','--name',clam,'--network',network,'--network-alias','clamav','--memory','4g','--cpus','1','-e','TZ=UTC','-e','FRESHCLAM_CHECKS=12','-e','CLAMD_CONF_StreamMaxLength=10M','-e','CLAMD_CONF_MaxThreads=2','-e','CLAMD_CONF_MaxQueue=4',clamImage]);
  await f.admin.query("UPDATE finance.contacts SET email='container-acceptance@example.invalid' WHERE organization_id=$1 AND id=$2",[f.org,f.contacts.customer]);
  const doc=await f.posted(f.body('invoice','123.00')),pdf=await getIssuedInvoicePdf(client,{organizationId:f.org,userId:f.ids.owner,memberId:(await f.admin.query('SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2',[f.org,f.ids.owner])).rows[0].id,capabilities:['sales.read','sales.write','documents.read']},doc.document_id);
  const facts=async()=>(await f.admin.query("SELECT jsonb_agg(to_jsonb(j) ORDER BY id) AS journals FROM finance.journal_entries j WHERE organization_id=$1",[f.org])).rows[0].journals;const before=await facts();
  await t.test('real SMTP container receives the existing issued PDF once; no public listener or runtime/owner credential',async()=>{
   const event=(await f.rpc('SELECT public.request_invoice_email_delivery($1,$2,$3,$4) AS value',[f.org,doc.document_id,pdf.pdfId,randomUUID()])).rows[0].value;
   const result=await run('mail',{SMTP_URL:'smtp://smtp-fixture:2525',SMTP_FROM:'acceptance@example.invalid',INVITATION_DELIVERY_KEY:process.env.INVITATION_DELIVERY_KEY,NEXT_PUBLIC_APP_URL:'https://acceptance.example.invalid'});assert.equal(result.sent,1);assert.equal(result.retried,0);
   assert.equal((await f.admin.query('SELECT status FROM finance.outbox_events WHERE id=$1',[event.outbox_event_id])).rows[0].status,'delivered');
   const messages=(await docker(['logs',smtp])).split('\n').filter(line=>line.startsWith('{')).map(JSON.parse);assert.equal(messages.length,1);assert.match(messages[0].messageId,new RegExp(event.outbox_event_id));assert.ok(messages[0].bytes>pdf.bytes.byteLength);assert.deepEqual(await facts(),before);
  });
  await t.test('Linux export worker renders the immutable report snapshot into private PDF bytes',async()=>{
   const filters={from:'2025-01-01',to:'2025-01-31'},snapshot=(await f.rpc("SELECT public.capture_report_export_snapshot($1,'profit_and_loss',$2::jsonb) AS value",[f.org,JSON.stringify(filters)])).rows[0].value,m=request('container export');
   const job=(await f.rpc("SELECT public.request_report_export($1,$2,$3,$4,'profit_and_loss','pdf',$5::jsonb) AS value",[f.org,m.id,m.key,m.hash,JSON.stringify({...filters,export_snapshot_id:snapshot.snapshot_id})])).rows[0].value;
   const result=await run('exports');assert.equal(result.completed,1);const row=(await f.admin.query('SELECT status,output_sha256 FROM finance.export_jobs WHERE organization_id=$1 AND id=$2',[f.org,job.id])).rows[0];assert.equal(row.status,'completed');const bytes=await readPrivateObject(`${f.org}/exports/${job.id}`);assert.equal(new TextDecoder().decode(bytes.subarray(0,5)),'%PDF-');assert.equal(createHash('sha256').update(bytes).digest('hex'),row.output_sha256);assert.deepEqual(await facts(),before);
  });
  await t.test('private Linux ClamAV releases only a real clean upload and the reminder runner uses the same restricted target',async()=>{
   for(let attempt=0;attempt<90;attempt++){const status=JSON.parse(await docker(['inspect',clam]))[0];if(status.State.Health?.Status==='healthy')break;if(attempt===89)throw new Error('ClamAV container did not become healthy.');await new Promise(resolve=>setTimeout(resolve,2000));}
   const draft=await f.save(f.body('invoice','1.00')),bytes=new TextEncoder().encode('Synthetic Linux container evidence.'),intent=await createUploadIntent(client,f.org,{document_id:draft.document_id,filename:'container-evidence.txt',content_type:'text/plain',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});await completeUpload(client,f.org,intent.intent_id,new File([bytes],'container-evidence.txt',{type:'text/plain'}));
   await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',intent.intent_id));const result=await run('scanner',{CLAMAV_HOST:'clamav',CLAMAV_PORT:'3310'});assert.equal(result.resolved,1);const artifact=await readPrivateArtifact(client,f.org,'attachments',intent.intent_id);assert.deepEqual(Buffer.from(await artifact.bytes.arrayBuffer()),Buffer.from(bytes));const reminder=await run('reminders');assert.ok(Number.isSafeInteger(reminder.queued));assert.deepEqual(await facts(),before);
  });
  console.log(JSON.stringify({fixture:'linux-containers',organizationId:f.org,image,restrictedWorkerOnly:true,privateNetwork:true,isolatedSmtpFixture:true,financialJournalsUnchanged:true}));
 }finally{
  await writeFile(join(directory,'clamav.log'),await docker(['logs','--tail','150',clam]).catch(()=>''),{mode:0o600});
  for(const name of containers.reverse())if(/^ams-test-[a-z-]+[0-9a-f-]{36}$/.test(name))await docker(['rm','-f',name]).catch(()=>{});
  await docker(['network','rm',network]).catch(()=>{});await f.close();
 }
});
