import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {workerConfiguration} from '../../scripts/background-jobs/config.mjs';
import {runSerialJobs} from '../../scripts/background-jobs/loop.mjs';

// Never store credential-shaped fixtures in source. These generated values
// cannot identify a real server: every test target uses the reserved .invalid.
function pg({user='ams_job_worker_login',host='worker.example.invalid',database='books',tls='require'}={}){
 const url=new URL(`postgresql://${host}/${database}`);url.username=user;url.password=randomBytes(16).toString('hex');url.searchParams.set('sslmode',tls);return url.toString();
}
const env={NODE_ENV:'production',DATABASE_WORKER_URL:pg(),DATABASE_WORKER_TARGET_URL:'postgresql://worker.example.invalid/books'};
test('worker deployment rejects owner/runtime credentials and mismatched targets before claiming work',()=>{
 assert.deepEqual(workerConfiguration(env,['reminders','--once']),{kind:'reminders',once:true,intervalMs:60000});
 for(const field of['DATABASE_URL','MIGRATION_DATABASE_URL','DATABASE_RUNTIME_URL','AUTH_SECRET'])assert.throws(()=>workerConfiguration({...env,[field]:'synthetic'},['reminders']),/Remove/);
 for(const value of[pg({user:'owner'}),pg({host:'other.example.invalid'}),pg({database:'other'}),pg({tls:'disable'})])assert.throws(()=>workerConfiguration({...env,DATABASE_WORKER_URL:value},['reminders']),/restricted TLS/);
 assert.throws(()=>workerConfiguration({...env,DATABASE_WORKER_TARGET_URL:pg({user:'owner'})},['reminders']),/no credentials/);
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

test('cloud scanner selects Bouncer explicitly without a ClamAV daemon or paid fallback',()=>{
 const storage={...env,OBJECT_STORE_BUCKET:'synthetic-private',OBJECT_STORE_ENDPOINT:'https://storage.example.invalid',AWS_ACCESS_KEY_ID:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic'};
 const cloud={...storage,ATTACHMENT_SCAN_PROVIDER:'bouncer',BOUNCER_API_KEY:`bnc_live_${randomBytes(24).toString('hex')}`,BOUNCER_UPLOAD_HOST:'bouncer-dev-uploads-000000000000.s3.ap-south-1.amazonaws.com'};
 assert.equal(workerConfiguration(cloud,['scanner','--once']).kind,'scanner');
 for(const changed of[{BOUNCER_API_KEY:''},{BOUNCER_UPLOAD_HOST:'127.0.0.1'},{BOUNCER_UPLOAD_HOST:'bouncer.example.invalid'},{ATTACHMENT_SCAN_PROVIDER:'other'}])assert.throws(()=>workerConfiguration({...cloud,...changed},['scanner']));
 assert.equal(workerConfiguration({...storage,CLAMAV_HOST:'clamav',CLAMAV_PORT:'3310'},['scanner']).kind,'scanner');
 assert.throws(()=>workerConfiguration(storage,['scanner']),/scanner host/);
});
test('scheduler interruption ends its idle wait and once mode never claims a second batch',async()=>{
 const stop=new AbortController();let calls=0;await runSerialJobs({signal:stop.signal,intervalMs:60000,run:async()=>{calls++;},wait:async()=>{stop.abort();throw new Error('interrupted');}});assert.equal(calls,1);
 const another=new AbortController();await runSerialJobs({signal:another.signal,intervalMs:60000,once:true,run:async()=>{calls++;}});assert.equal(calls,2);
});
