import assert from 'node:assert/strict';
import test from 'node:test';
import {workerConfiguration} from '../../scripts/background-jobs/config.mjs';
import {runSerialJobs} from '../../scripts/background-jobs/loop.mjs';

const env={NODE_ENV:'production',DATABASE_WORKER_URL:'postgresql://ams_job_worker_login:synthetic@worker.example.invalid/books?sslmode=require',DATABASE_WORKER_TARGET_URL:'postgresql://worker.example.invalid/books'};
test('worker deployment rejects owner/runtime credentials and mismatched targets before claiming work',()=>{
 assert.deepEqual(workerConfiguration(env,['reminders','--once']),{kind:'reminders',once:true,intervalMs:60000});
 for(const field of['DATABASE_URL','MIGRATION_DATABASE_URL','DATABASE_RUNTIME_URL','AUTH_SECRET'])assert.throws(()=>workerConfiguration({...env,[field]:'synthetic'},['reminders']),/Remove/);
 for(const value of['postgresql://owner:synthetic@worker.example.invalid/books?sslmode=require','postgresql://ams_job_worker_login:synthetic@other.example.invalid/books?sslmode=require','postgresql://ams_job_worker_login:synthetic@worker.example.invalid/other?sslmode=require','postgresql://ams_job_worker_login:synthetic@worker.example.invalid/books?sslmode=disable'])assert.throws(()=>workerConfiguration({...env,DATABASE_WORKER_URL:value},['reminders']),/restricted TLS/);
 assert.throws(()=>workerConfiguration({...env,DATABASE_WORKER_TARGET_URL:'postgresql://owner:synthetic@worker.example.invalid/books'},['reminders']),/no credentials/);
 for(const args of[[],['other'],['mail','reminders'],['reminders','--once','--once']])assert.throws(()=>workerConfiguration(env,args));
 assert.throws(()=>workerConfiguration({...env,AMS_JOB_INTERVAL_MS:'0'},['reminders']));
 for(const kind of['mail','exports','scanner'])assert.throws(()=>workerConfiguration(env,[kind]),/OBJECT_STORE_BUCKET/);
});
test('private storage and external SMTP cannot silently downgrade TLS',()=>{
 const mail={...env,OBJECT_STORE_BUCKET:'synthetic-private',OBJECT_STORE_ENDPOINT:'https://storage.example.invalid',AWS_ACCESS_KEY_ID:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic',SMTP_URL:'smtps://synthetic:synthetic@smtp.example.invalid:465',SMTP_FROM:'synthetic@example.invalid',INVITATION_DELIVERY_KEY:'a'.repeat(64),NEXT_PUBLIC_APP_URL:'https://app.example.invalid'};
 assert.equal(workerConfiguration(mail,['mail']).kind,'mail');
 assert.equal(workerConfiguration({...mail,SMTP_URL:'smtp://synthetic:synthetic@smtp.example.invalid:587?requireTLS=true'},['mail']).kind,'mail');
 for(const url of['smtp://synthetic:synthetic@smtp.example.invalid:587','smtps://synthetic:synthetic@smtp.example.invalid:465?tls.rejectUnauthorized=false','smtps://synthetic:synthetic@smtp.example.invalid:465?secure=false'])assert.throws(()=>workerConfiguration({...mail,SMTP_URL:url},['mail']),/TLS/);
 assert.throws(()=>workerConfiguration({...mail,OBJECT_STORE_ENDPOINT:'http://storage.example.invalid'},['mail']),/HTTPS/);
});
test('serial scheduler never overlaps batches and drains the in-flight batch on termination',async()=>{
 const stop=new AbortController();let release,entered;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});let claimed=0,finished=0;
 const running=runSerialJobs({signal:stop.signal,intervalMs:1,run:async()=>{claimed++;entered();await gate;finished++;}});
 await started;await Promise.resolve();assert.equal(claimed,1);assert.equal(finished,0);stop.abort();release();await running;assert.equal(claimed,1);assert.equal(finished,1);
});
test('scheduler interruption ends its idle wait and once mode never claims a second batch',async()=>{
 const stop=new AbortController();let calls=0;await runSerialJobs({signal:stop.signal,intervalMs:60000,run:async()=>{calls++;},wait:async()=>{stop.abort();throw new Error('interrupted');}});assert.equal(calls,1);
 const another=new AbortController();await runSerialJobs({signal:another.signal,intervalMs:60000,once:true,run:async()=>{calls++;}});assert.equal(calls,2);
});
