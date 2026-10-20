import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from '@neondatabase/serverless';
import '../../scripts/load-local-env.mjs';
import { createIdentityUser, issueIdentityToken, consumeVerificationToken } from '../../apps/web/server/auth/identity.ts';

test('verification tokens enforce cooldown, single use, expiry and independent issuance races', {timeout:90000}, async t => {
  assert.equal(process.env.AMS_DATABASE_TESTS,'isolated','Requires the explicitly selected disposable test database.');
  assert.equal(new URL(process.env.DATABASE_RUNTIME_URL).hostname,process.env.AMS_TEST_DATABASE_HOST);
  assert.notEqual(process.env.AMS_TEST_DATABASE_HOST,'ep-summer-flower-b45z3gnu-pooler.c-6.us-east-2.aws.neon.tech');
  const pool=new Pool({connectionString:process.env.DATABASE_RUNTIME_URL,max:1});
  try {
    const role=(await pool.query(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AS restricted,
      pg_has_role(current_user,'ams_runtime','MEMBER') AS runtime FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.ok(role.restricted&&role.runtime);
    const user=await createIdentityUser(`verify-${randomUUID()}@example.invalid`,'SyntheticVerificationTest123','Verification test');
    assert.ok(user);
    await t.test('cooldown preserves the first link; consumption and replay are atomic', async()=>{
      const token=await issueIdentityToken(user,'verify_email');
      await assert.rejects(issueIdentityToken(user,'verify_email'),/too recently/);
      assert.equal(await consumeVerificationToken(token,'verify_email'),user);
      assert.equal(await consumeVerificationToken(token,'verify_email'),null);
      assert.equal((await pool.query('SELECT email_verified_at IS NOT NULL AS verified FROM identity.users WHERE id=$1',[user])).rows[0].verified,true);
    });
    await t.test('expired tokens fail and different purposes have independent limits',async()=>{
      const token=await issueIdentityToken(user,'reset_password');
      await pool.query("UPDATE identity.verification_tokens SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND purpose='reset_password'",[user]);
      assert.equal(await consumeVerificationToken(token,'reset_password'),null);
      assert.equal(await consumeVerificationToken('invalid','verify_email'),null);
    });
    await t.test('four independent app processes issue one live verification link',async()=>{
      const raceUser=await createIdentityUser(`verify-race-${randomUUID()}@example.invalid`,'SyntheticVerificationTest123','Verification race test');
      const code=`import {issueIdentityToken} from './apps/web/server/auth/identity.ts';
        try{const token=await issueIdentityToken(process.env.AMS_TOKEN_RACE_USER,'verify_email');console.log(JSON.stringify({token}));}
        catch(error){if(!/too recently/.test(error.message)){process.exitCode=1;}console.log(JSON.stringify({limited:/too recently/.test(error.message)}));}`;
      const results=await Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,['--conditions=react-server','--input-type=module','-e',code],{
          env:{...process.env,AMS_TOKEN_RACE_USER:raceUser},stdio:['ignore','pipe','pipe']});
        let output='';child.stdout.on('data',chunk=>{output+=chunk;});
        child.on('error',reject);child.on('close',status=>{
          if(status!==0)return reject(new Error('Token race process failed.'));
          try{resolve(JSON.parse(output));}catch{reject(new Error('Token race returned an invalid result.'));}
        });
      })));
      const successes=results.filter(result=>typeof result.token==='string');
      assert.equal(successes.length,1);assert.equal(results.filter(result=>result.limited).length,3);
      assert.equal(await consumeVerificationToken(successes[0].token,'verify_email'),raceUser);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM identity.verification_tokens WHERE user_id=$1 AND purpose='verify_email'",[raceUser])).rows[0].count,1);
    });
  }finally{await pool.end();}
});
