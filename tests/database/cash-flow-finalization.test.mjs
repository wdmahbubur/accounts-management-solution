import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createAccountingFixture,request,money} from './helpers/accounting-fixture.mjs';
test('cash-flow finalization preserves reviewed evidence and rejects provisional/stale/unauthorized reports',{timeout:300_000},async t=>{
 const f=await createAccountingFixture();
 const review=async(id=null,user=f.ids.owner)=>(await f.rpc("SELECT public.read_cash_flow_review($1,'2025-01-01','2025-01-31',$2) AS value",[f.org,id],user,{readOnly:true})).rows[0].value;
 const finalize=async(digest,m=request(digest),user=f.ids.owner)=>(await f.rpc("SELECT public.finalize_cash_flow_report($1,'2025-01-01','2025-01-31',$2,$3,$4,$5) AS value",[f.org,digest,m.id,m.key,m.hash],user)).rows[0].value;
 const cash=classification=>f.body('manual_journal','100.00',{journal_rows:[{account_id:f.accounts['1010'],debit:'100.00',credit:'0.00',cash_flow_class:classification,description:'Synthetic cash classification'},{account_id:f.accounts['3000'],debit:'0.00',credit:'100.00',description:'Synthetic capital'}]});
 try{
  await f.posted(cash('financing'));const shown=await review();let saved,savedSnapshot;
  await t.test('T-42 finance review creates one immutable snapshot and one audit under replay and different-key races',async()=>{
   const m=request(shown.material_digest);saved=await finalize(shown.material_digest,m);assert.deepEqual(await finalize(shown.material_digest,m),saved);savedSnapshot=(await review(saved.finalization_id)).snapshot;
   const{cutoff_at:shownCutoff,...shownData}=shown.snapshot.data;const{cutoff_at:savedCutoff,...savedData}=savedSnapshot.data;assert.deepEqual(savedData,shownData);assert.ok(savedCutoff>=shownCutoff);
   await assert.rejects(()=>finalize(shown.material_digest,{...m,hash:'f'.repeat(64)}),e=>e.code==='23505');
   const concurrent=await Promise.all([finalize(shown.material_digest),finalize(shown.material_digest)]);assert.ok(concurrent.every(r=>r.finalization_id===saved.finalization_id));
   const counts=(await f.admin.query("SELECT (SELECT count(*)::int FROM finance.cash_flow_finalizations WHERE organization_id=$1) AS snapshots,(SELECT count(*)::int FROM finance.audit_events WHERE organization_id=$1 AND action='cash-flow.finalize') AS audits",[f.org])).rows[0];assert.deepEqual(counts,{snapshots:1,audits:1});
   await assert.rejects(()=>f.rpc('SELECT * FROM finance.cash_flow_finalizations WHERE organization_id=$1',[f.org]),e=>e.code==='42501');
   await assert.rejects(()=>f.admin.query('UPDATE finance.cash_flow_finalizations SET starts_on=starts_on WHERE id=$1',[saved.finalization_id]),e=>e.code==='55000');
  });
  await t.test('S-01/S-03 finalization needs live report/close authority and a matching company',async()=>{
   for(const user of[f.ids.billing,f.ids.auditor,f.ids.outsider])await assert.rejects(()=>finalize(shown.material_digest,request(user),user),e=>e.code==='42501');
   await assert.rejects(()=>review(saved.finalization_id,f.ids.outsider),e=>e.code==='42501');
   await assert.rejects(()=>f.rpc("SELECT public.read_cash_flow_review($1,'2025-01-01','2025-01-31',$2)",[randomUUID(),saved.finalization_id]),e=>e.code==='42501');
  });
  await t.test('T-42 stale reviewed totals and unclassified cash cannot receive a finalized label',async()=>{
   await f.posted(cash('unclassified'));const current=await review();assert.equal(current.snapshot.provisional,true);assert.equal(current.matches_latest,false);money(current.snapshot.data.unclassified,'100.00');
   await assert.rejects(()=>finalize(shown.material_digest),e=>e.code==='40001');
   await assert.rejects(()=>finalize(current.material_digest),e=>e.code==='23514');
   const historical=await review(saved.finalization_id);assert.equal(historical.finalization_id,saved.finalization_id);assert.deepEqual(historical.snapshot,savedSnapshot);money(historical.snapshot.data.closing_cash,'100.00');
   assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.cash_flow_finalizations WHERE organization_id=$1',[f.org])).rows[0].n,1);
  });
  console.log(JSON.stringify({fixture:'cash-flow-finalization',organizationId:f.org,finalizationId:saved.finalization_id}));
 }finally{await f.close();}
});
