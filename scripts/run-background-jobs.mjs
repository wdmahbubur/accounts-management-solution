import {writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {neonConfig} from '@neondatabase/serverless';
import {workerConfiguration} from './background-jobs/config.mjs';
import {runSerialJobs} from './background-jobs/loop.mjs';

// No listening socket, application runtime login, owner URL or public worker API.
// The existing database leases remain the only authority to claim/finish jobs.
const log=value=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...value})+'\n');
let config;
try{config=workerConfiguration(process.env,process.argv.slice(2));}catch(error){log({event:'worker.configuration_error',message:error.message});process.exit(1);}
neonConfig.webSocketConstructor=WebSocket;
const {withWorkerDatabase,closeWorkerDatabase}=await import('../apps/web/server/database.ts');
const stop=new AbortController();
for(const signal of['SIGTERM','SIGINT'])process.on(signal,()=>{log({event:'worker.draining',kind:config.kind});stop.abort();});
const heartbeat=join(tmpdir(),`ams-worker-${config.kind}-heartbeat.json`);
async function batch(){
 if(config.kind==='mail')return(await import('../apps/web/server/outbox/worker.ts')).processOutboxBatch(1);
 if(config.kind==='exports')return(await import('../apps/web/server/exports/worker.ts')).processTrialBalanceExportBatch(1);
 if(config.kind==='scanner'){
  await(await import('../apps/web/server/artifacts/scan-providers.ts')).attachmentScanProvider().scanner.check();
  return(await import('../apps/web/server/artifacts/scanner-worker.ts')).processAttachmentScanBatch(1);
 }
 const result=await withWorkerDatabase(db=>db.query('SELECT finance_private.enqueue_due_notification_reminders() AS queued'));
 const queued=Number(result.rows[0]?.queued);if(!Number.isSafeInteger(queued)||queued<0)throw new Error('Invalid scheduler result.');return{queued};
}
try{
 await runSerialJobs({signal:stop.signal,intervalMs:config.intervalMs,once:config.once,run:async()=>{
  // Outbox's shortest lease is 120s. End an unresponsive process before it
  // expires; the next process reclaims through the existing lease protocol.
  const watchdog=setTimeout(()=>{log({event:'worker.batch_deadline',kind:config.kind});process.exit(1);},90000);
  try{const result=await batch();const status={event:'worker.batch_complete',kind:config.kind,result};log(status);await writeFile(heartbeat,JSON.stringify({at:Date.now(),kind:config.kind,intervalMs:config.intervalMs}),{mode:0o600});}
  catch(error){const code=typeof error?.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(error.code)?error.code:'BATCH_ERROR';log({event:'worker.batch_failed',kind:config.kind,code});if(config.once)process.exitCode=1;}
  finally{clearTimeout(watchdog);}
 }});
}finally{await closeWorkerDatabase();}
