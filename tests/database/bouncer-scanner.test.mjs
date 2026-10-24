import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createAccountingFixture} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {createUploadIntent,completeUpload} from '../../apps/web/server/artifacts/uploads.ts';
import {readPrivateArtifact} from '../../apps/web/server/artifacts/download.ts';
const exec=promisify(execFile);
async function docker(args){return(await exec('docker',args,{timeout:150000,maxBuffer:1024*1024})).stdout.trim();}

test('real free-tier Bouncer scans synthetic private evidence in a restricted 192 MiB Linux worker',{timeout:900000},async t=>{
 assert.equal(process.env.AMS_SCANNER_TESTS,'real-bouncer-docker');
 assert.equal(process.env.ATTACHMENT_SCAN_PROVIDER,'bouncer');
 const image=process.env.AMS_JOBS_TEST_IMAGE;assert.match(image??'',/^ams-jobs:[a-z0-9-]+$/);
 assert.equal(process.env.OBJECT_STORE_BUCKET,'ams-recovery-drill');assert.equal(new URL(process.env.OBJECT_STORE_ENDPOINT).hostname,process.env.AMS_RECOVERY_STORAGE_HOST);
 const f=await createAccountingFixture(),client=fixtureRpcClient(f),token=randomUUID(),network=`ams-bouncer-${token}`,containers=[];
 const directory=resolve('output','worker-tests',token);await mkdir(directory,{recursive:true,mode:0o700});
 const target=new URL(process.env.DATABASE_RUNTIME_URL);target.username='';target.password='';target.search='';target.hash='';
 const values={NODE_ENV:'production',DATABASE_WORKER_URL:process.env.DATABASE_WORKER_URL,DATABASE_WORKER_TARGET_URL:target.toString()};
 for(const key of['OBJECT_STORE_BUCKET','OBJECT_STORE_ENDPOINT','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION','ATTACHMENT_SCAN_PROVIDER','BOUNCER_API_KEY','BOUNCER_UPLOAD_HOST'])if(process.env[key])values[key]=process.env[key];
 assert.ok(Object.values(values).every(value=>typeof value==='string'&&!/[\r\n\0]/.test(value)));
 const file=join(directory,'scanner.env');await writeFile(file,Object.entries(values).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
 const peaks=[],receipts=[];
 const usage=async()=>{const r=await fetch('https://api.usebouncer.dev/v1/scan/usage',{headers:{'X-API-Key':process.env.BOUNCER_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);const data=(await r.json()).data;assert.equal(data.tier,'free');assert.equal(data.scans_limit,500);return data.scans_used;};
 const facts=async()=>(await f.admin.query(`SELECT (SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1)::int AS journals,
   (SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1)::int AS lines,
   (SELECT count(*) FROM finance.open_items WHERE organization_id=$1)::int AS open_items,
   (SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1)::int AS allocations`,[f.org])).rows[0];
 const row=async id=>(await f.admin.query('SELECT scan_status,scan_error_code,scan_attempt_count,scan_engine_version FROM finance.attachments WHERE organization_id=$1 AND id=$2',[f.org,id])).rows[0];
 async function run(){
  const name=`ams-bouncer-worker-${token}-${containers.length}`;containers.push(name);
  const output=await docker(['run','--name',name,'--network',network,'--memory','192m','--cpus','0.25','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,noexec,size=16m,mode=1777','-e','NODE_OPTIONS=--max-old-space-size=80','--mount',`type=bind,source=${file},target=/run/secrets/worker_env,readonly`,'--mount',`type=bind,source=${resolve('tests/database/helpers/measure-scanner.mjs')},target=/probe.mjs,readonly`,'--entrypoint','node',image,'--conditions=react-server','--env-file=/run/secrets/worker_env','/probe.mjs']);
  const inspected=JSON.parse(await docker(['inspect',name]))[0];assert.equal(inspected.State.ExitCode,0,output);assert.equal(inspected.State.OOMKilled,false);
  assert.equal(inspected.Config.User,'node');assert.ok(inspected.Config.Env.every(value=>!/(DATABASE|SMTP|AWS_ACCESS|AWS_SECRET|INVITATION|BOUNCER)/.test(value)));
  assert.equal(inspected.HostConfig.Memory,192*1024*1024);assert.equal(inspected.HostConfig.ReadonlyRootfs,true);assert.ok(inspected.HostConfig.CapDrop.includes('ALL'));
  assert.equal(Object.keys(inspected.HostConfig.PortBindings??{}).length,0);assert.deepEqual(Object.keys(inspected.NetworkSettings.Networks),[network]);
  const events=output.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse),completed=events.filter(event=>event.event==='worker.batch_complete');
  assert.equal(completed.length,1,output);assert.equal(events.some(event=>event.event==='worker.batch_failed'),false,output);
  const peak=events.find(event=>event.event==='test.memory_peak')?.bytes;assert.ok(Number.isSafeInteger(peak)&&peak>0&&peak<=192*1024*1024);peaks.push(peak);
  console.log(JSON.stringify({stage:'container-batch',result:completed[0].result,peakBytes:peak}));return completed[0].result;
 }
 try{
  const competing=(await f.admin.query("SELECT count(*)::int AS count FROM finance.attachments WHERE scan_status='pending' AND scan_available_at<=now() AND (scan_lease_until IS NULL OR scan_lease_until<=now())")).rows[0].count;
  assert.equal(competing,0,'Use a database with no competing eligible scan jobs.');
  const before=await facts(),usageBefore=await usage();assert.ok(usageBefore<=497);
  await docker(['network','create',network]);
  const eicar=new TextEncoder().encode(['X5O!P%@AP[4\\PZX54(P^)7CC)7}','$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
  for(const [label,bytes,expected]of[['clean',new TextEncoder().encode('Synthetic Bouncer evidence. No customer information.'),'clean'],['eicar',eicar,'rejected'],['10-mib',new Uint8Array(10*1024*1024).fill(65),'clean']]){
   await t.test(`${label}: private upload, quarantine, durable scan and authorized result`,async()=>{
    console.log(JSON.stringify({stage:'upload-start',label,byteSize:bytes.length}));
    const doc=await f.save(f.body('invoice','1.00')),sha=createHash('sha256').update(bytes).digest('hex');
    const intent=await createUploadIntent(client,f.org,{document_id:doc.document_id,filename:`synthetic-${label}.txt`,content_type:'text/plain',byte_size:bytes.length,sha256:sha});
    const uploaded=await completeUpload(client,f.org,intent.intent_id,new File([bytes],`synthetic-${label}.txt`,{type:'text/plain'}));assert.equal(uploaded.scan_status,'pending_scan');
    console.log(JSON.stringify({stage:'quarantined',label}));
    await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',intent.intent_id),e=>e.code==='NOT_FOUND');
    let savedId=null,resumed=false,cycles=0,readFailures=0;
    for(;cycles<6;cycles++){
     const batch=await run();assert.equal(batch.claimed,1);assert.equal(batch.lease_lost,0);
     const reference=(await f.admin.query("SELECT remote_id FROM finance_private.attachment_provider_scans WHERE organization_id=$1 AND attachment_id=$2 AND provider='bouncer'",[f.org,intent.intent_id])).rows[0];
     const current=await row(intent.intent_id);
     if(!reference&&current.scan_status==='pending'&&current.scan_error_code==='OBJECT_READ_ERROR'){
      // A bounded storage failure occurred before POST and abandoned its local
      // reservation. Retry the same immutable object; this consumes no scan.
      readFailures++;assert.equal(current.scan_attempt_count,readFailures);
     }else{
      assert.ok(reference?.remote_id);if(savedId){assert.equal(reference.remote_id,savedId);resumed=true;}savedId=reference.remote_id;
      if(current.scan_status!=='pending')break;
      assert.equal(current.scan_error_code,'SCAN_PENDING');assert.equal(current.scan_attempt_count,readFailures);
     }
     await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',intent.intent_id),e=>e.code==='NOT_FOUND');
     await f.admin.query("UPDATE finance.attachments SET scan_available_at=now()-interval '1 second' WHERE organization_id=$1 AND id=$2 AND scan_status='pending'",[f.org,intent.intent_id]);
    }
    const current=await row(intent.intent_id);assert.equal(current.scan_status,expected,JSON.stringify(current));assert.equal(current.scan_engine_version,'Bouncer-api-v2');
    console.log(JSON.stringify({stage:'decision',label,status:current.scan_status}));
    if(expected==='clean'){const artifact=await readPrivateArtifact(client,f.org,'attachments',intent.intent_id);assert.equal(createHash('sha256').update(Buffer.from(await artifact.bytes.arrayBuffer())).digest('hex'),sha);console.log(JSON.stringify({stage:'download-verified',label}));}
    else await assert.rejects(()=>readPrivateArtifact(client,f.org,'attachments',intent.intent_id),e=>e.code==='NOT_FOUND');
    await assert.rejects(()=>readPrivateArtifact(fixtureRpcClient(f,f.ids.outsider),f.org,'attachments',intent.intent_id),e=>e.code==='NOT_FOUND');
    assert.deepEqual(await facts(),before);receipts.push({label,byteSize:bytes.length,decision:current.scan_status,cycles:cycles+1,resumedSameReference:resumed});
   });
  }
  assert.equal(receipts.length,3,'Every synthetic case must pass before emitting acceptance.');
  const usageAfter=await usage();assert.equal(usageAfter-usageBefore,3,'Exactly one provider creation per synthetic file, even across container restarts.');
  console.log(JSON.stringify({fixture:'real-bouncer-docker',organizationId:f.org,image,freeTier:true,scansConsumed:usageAfter-usageBefore,receipts,memoryLimitBytes:192*1024*1024,peakBytes:Math.max(...peaks),restrictedWorkerOnly:true,financialFactsUnchanged:true}));
 }finally{
  await f.admin.query("UPDATE finance.attachments SET scan_available_at=now()+interval '1 year',scan_lease_token=NULL,scan_lease_until=NULL WHERE organization_id=$1 AND scan_status='pending'",[f.org]);
  for(const name of containers.reverse())if(new RegExp(`^ams-bouncer-worker-${token}-[0-9]+$`).test(name))await docker(['rm','-f',name]).catch(()=>{});
  await docker(['network','rm',network]).catch(()=>{});await f.close();
 }
});
