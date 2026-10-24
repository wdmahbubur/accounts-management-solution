import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAccountingFixture} from './helpers/accounting-fixture.mjs';
test('subscription summary is live, permission scoped and does not create paid or accounting state',{timeout:120_000},async t=>{
 const f=await createAccountingFixture();
 try{
  await t.test('Owner reads actual member usage with no invented paid plan',async()=>{
   const r=(await f.rpc('SELECT public.read_subscription_summary($1) AS value',[f.org],f.ids.owner,{readOnly:true})).rows[0].value;
   assert.deepEqual(r,{organization_id:f.org,subscription:null,active_members:4});
   const counts=(await f.admin.query('SELECT (SELECT count(*) FROM finance.subscriptions WHERE organization_id=$1)::integer AS subscriptions,(SELECT count(*) FROM finance.billing_events WHERE organization_id=$1)::integer AS billing_events,(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1)::integer AS journals',[f.org])).rows[0];assert.deepEqual(counts,{subscriptions:0,billing_events:0,journals:0});
  });
  await t.test('Billing, Auditor, nonmember and foreign companies cannot read platform subscription information',async()=>{
   for(const user of[f.ids.billing,f.ids.auditor,f.ids.outsider])await assert.rejects(()=>f.rpc('SELECT public.read_subscription_summary($1)',[f.org],user),e=>['42501','P0002'].includes(e.code));
   await assert.rejects(()=>f.rpc('SELECT public.read_subscription_summary($1)',[randomUUID()]),e=>['42501','P0002'].includes(e.code));
   await assert.rejects(()=>f.rpc("INSERT INTO finance.plans(code,name,entitlements) VALUES('untrusted','Untrusted','{}')"),e=>e.code==='42501');
  });
  console.log(JSON.stringify({fixture:'subscription-summary',organizationId:f.org,paidBillingEnabled:false}));
 }finally{await f.close();}
});
