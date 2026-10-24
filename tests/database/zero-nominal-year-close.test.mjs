import assert from 'node:assert/strict';
import test from 'node:test';
import {createAccountingFixture,money,request} from './helpers/accounting-fixture.mjs';

function controls(f){
 const read=async(sql,args=[],actor=f.ids.owner)=>(await f.rpc(sql,args,actor)).rows;
 const year=async()=>(await read('SELECT id FROM finance.fiscal_years WHERE organization_id=$1 ORDER BY starts_on',[f.org]))[0].id;
 const preview=async id=>(await read('SELECT public.read_year_close_preview($1,$2) AS value',[f.org,id]))[0].value;
 const action=async(kind,id,meta=request([kind,id]),actor=f.ids.owner)=>(await read(`SELECT public.${kind}_fiscal_year($1,$2,$3,$4,$5,$6) AS value`,[f.org,id,meta.id,meta.key,meta.hash,'Synthetic auditable annual close and recovery rehearsal'],actor))[0].value;
 const lock=async id=>{for(const p of await read('SELECT * FROM finance.accounting_periods WHERE organization_id=$1 AND fiscal_year_id=$2 ORDER BY starts_on,id',[f.org,id]))if(p.status==='open')await read('SELECT * FROM public.lock_accounting_period($1,$2,$3,$4,$5)',[f.org,p.id,p.row_version,request(p).id,'Synthetic annual close prerequisites checked']);};
 const facts=async()=>(await f.admin.query(`SELECT jsonb_build_object(
 'documents',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]') FROM finance.business_documents d WHERE organization_id=$1),
 'journals',(SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY id),'[]') FROM finance.journal_entries j WHERE organization_id=$1),
 'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM finance.journal_lines l WHERE organization_id=$1),
 'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY id),'[]') FROM finance.open_items i WHERE organization_id=$1),
 'allocations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM finance.settlement_allocations a WHERE organization_id=$1)) AS value`,[f.org])).rows[0].value;
 const reports=async()=>({pl:(await read("SELECT public.read_profit_loss_snapshot($1,'2025-01-01','2025-12-31',NULL,NULL,NULL) AS value",[f.org]))[0].value.data,
  bs:(await read("SELECT public.read_balance_sheet_snapshot($1,'2025-12-31',NULL) AS value",[f.org]))[0].value.data.current});
 return{read,year,preview,action,lock,facts,reports};
}

test('dormant years close and reopen with immutable snapshots, actual races and no artificial journal',{timeout:600000},async t=>{
 const f=await createAccountingFixture(),c=controls(f);let year,closed,firstSnapshot;
 try{
  year=await c.year();const before=await c.facts();
  await t.test('missing prerequisites, capability, tenant and recent authentication cannot close a dormant year',async()=>{
   assert.equal((await c.preview(year)).can_close,false);
   await assert.rejects(()=>c.action('close',year),e=>e.code==='23514');
   for(const actor of[f.ids.billing,f.ids.outsider])await assert.rejects(()=>c.action('close',year,request(actor),actor),e=>['42501','P0002'].includes(e.code));
   await f.admin.query("UPDATE identity.auth_sessions SET recent_auth_at=now()-interval '2 days' WHERE user_id=$1",[f.ids.owner]);
   await assert.rejects(()=>c.action('close',year),e=>['28000','42501'].includes(e.code));
   await f.admin.query('UPDATE identity.auth_sessions SET recent_auth_at=now() WHERE user_id=$1',[f.ids.owner]);assert.deepEqual(await c.facts(),before);
  });
  await t.test('same-key independent close connections replay one zero-nominal snapshot and leave reports/facts unchanged',async()=>{
   await c.lock(year);const preview=await c.preview(year);assert.equal(preview.nominal_account_count,0);assert.equal(preview.can_close,true);assert.equal(preview.close_kind,'zero_nominal');
   const meta=request('same-key zero close'),results=await Promise.all([c.action('close',year,meta),c.action('close',year,meta)]);assert.deepEqual(results[0],results[1]);closed=results[0];
   assert.equal(closed.close_kind,'zero_nominal');assert.equal(closed.document_id,null);assert.equal(closed.journal_entry_id,null);assert.equal(closed.document_number,null);money(closed.profit,'0.00');assert.deepEqual(await c.facts(),before);
   const history=(await c.read('SELECT * FROM finance.year_close_runs WHERE organization_id=$1',[f.org]));assert.equal(history.length,1);firstSnapshot=history[0].report_snapshot;assert.equal(history[0].close_document_id,null);
   const workspace=(await c.read('SELECT public.list_year_close_workspace($1) AS value',[f.org]))[0].value;assert.equal(workspace[0].active_close.close_kind,'zero_nominal');assert.equal(workspace[0].active_close.document_id,null);
   const r=await c.reports();money(r.pl.totals.net_profit,'0.00');money(r.bs.difference,'0.00');money(r.bs.untransferred_earnings,'0.00');
   await assert.rejects(()=>f.admin.query("UPDATE finance.year_close_runs SET report_snapshot='{}' WHERE organization_id=$1",[f.org]),e=>e.code==='23514');
   await assert.rejects(()=>f.rpc('DELETE FROM finance.year_close_runs WHERE organization_id=$1',[f.org]),e=>e.code==='42501');
  });
  await t.test('same-key reopen connections record one dated actor/reason event and no reversal journal',async()=>{
   const meta=request('same-key zero reopen'),results=await Promise.all([c.action('reopen',year,meta),c.action('reopen',year,meta)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].close_kind,'zero_nominal');assert.equal(results[0].reopen_document_id,null);assert.equal(results[0].journal_entry_id,null);
   const run=(await c.read('SELECT * FROM finance.year_close_runs WHERE organization_id=$1 AND id=$2',[f.org,closed.run_id]))[0];assert.deepEqual(run.report_snapshot,firstSnapshot);assert.ok(run.reopened_at);assert.ok(run.reopened_by_member_id);assert.match(run.reopen_reason,/Synthetic/);assert.equal(run.reopen_document_id,null);
   assert.deepEqual(await c.facts(),before);assert.equal((await c.read("SELECT count(*)::int AS n FROM finance.accounting_periods WHERE organization_id=$1 AND fiscal_year_id=$2 AND status='open'",[f.org,year]))[0].n,12);
   await assert.rejects(()=>f.admin.query('UPDATE finance.year_close_runs SET reopened_at=clock_timestamp() WHERE organization_id=$1',[f.org]),e=>e.code==='23514');
  });
  await t.test('different-key close race records one new active snapshot and preserves the reopened prior run',async()=>{
   await c.lock(year);const results=await Promise.allSettled([c.action('close',year),c.action('close',year)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'23514');
   const runs=await c.read('SELECT * FROM finance.year_close_runs WHERE organization_id=$1',[f.org]);assert.equal(runs.length,2);assert.equal(runs.filter(r=>!r.reopen_document_id&&!r.reopened_at).length,1);assert.deepEqual(runs.find(r=>r.id===closed.run_id).report_snapshot,firstSnapshot);assert.deepEqual(await c.facts(),before);
  });
  await t.test('consecutive years and close/reopen races preserve chronological order',async()=>{
   // Administrative synthetic calendar setup: no public calendar-creation or
   // next-year UI behavior is asserted by this close-command regression.
   const later=(await f.admin.query("INSERT INTO finance.fiscal_years(organization_id,label,starts_on,ends_on) VALUES($1,'FY 2026','2026-01-01','2026-12-31') RETURNING id",[f.org])).rows[0].id;
   await f.admin.query("INSERT INTO finance.accounting_periods(organization_id,fiscal_year_id,label,kind,starts_on,ends_on) SELECT $1,$2,to_char(day,'YYYY-MM'),'regular',day::date,(day+interval '1 month'-interval '1 day')::date FROM generate_series('2026-01-01'::date,'2026-12-01'::date,interval '1 month') day",[f.org,later]);
   await c.lock(later);const laterClose=await c.action('close',later);assert.equal(laterClose.close_kind,'zero_nominal');await assert.rejects(()=>c.action('reopen',year),e=>e.code==='23514');
   await c.action('reopen',later);await c.action('reopen',year);await c.lock(year);await c.action('close',year);await c.lock(later);
   const results=await Promise.allSettled([c.action('close',later),c.action('reopen',year)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'23514');
   const states=await c.read('SELECT id,status FROM finance.fiscal_years WHERE organization_id=$1 ORDER BY starts_on',[f.org]);assert.ok(!(states[0].status==='open'&&states[1].status==='closed'));assert.deepEqual(await c.facts(),before);
  });
  console.log(JSON.stringify({fixture:'zero-nominal-years',organizationId:f.org,financialFactsUnchanged:true,actualConnections:true}));
 }finally{await f.close();}
});

for(const mode of['balance_sheet_only','fully_reversed','zero_net','loss'])test(`year close retains correct journal behavior for ${mode}`,{timeout:300000},async()=>{
 const f=await createAccountingFixture(),c=controls(f);
 try{
  if(mode==='balance_sheet_only')await f.posted(f.body('manual_journal','100.00',{journal_rows:[{account_id:f.accounts['1500'],debit:'100.00',credit:'0.00',description:'Synthetic noncash opening-year asset'},{account_id:f.accounts['3000'],debit:'0.00',credit:'100.00',description:'Synthetic capital contribution'}]}));
  if(['fully_reversed','zero_net'].includes(mode)){const invoice=await f.posted(f.body('invoice','100.00'));if(mode==='fully_reversed'){const m=request(invoice);await f.rpc("SELECT * FROM public.reverse_posted_document($1,$2,'2025-01-20','Synthetic complete nominal reversal',$3,$4,$5)",[f.org,invoice.document_id,m.id,m.key,m.hash]);}}
  if(['zero_net','loss'].includes(mode))await f.posted(f.body('bill','100.00'));
  const before=await c.facts(),reports=await c.reports(),year=await c.year();await c.lock(year);const close=await c.action('close',year);
  const kind=['balance_sheet_only','fully_reversed'].includes(mode)?'zero_nominal':'journal';assert.equal(close.close_kind,kind);money(close.profit,mode==='loss'?'-100.00':'0.00');
  const after=await c.facts();if(kind==='zero_nominal')assert.deepEqual(after,before);else{assert.ok(close.document_id);assert.ok(close.journal_entry_id);assert.equal(after.journals.length,before.journals.length+1);const totals=(await c.read('SELECT sum(debit)::text AS debit,sum(credit)::text AS credit FROM finance.journal_lines WHERE organization_id=$1 AND journal_entry_id=$2',[f.org,close.journal_entry_id]))[0];money(totals.debit,'100.00');money(totals.credit,'100.00');}
  const closed=await c.reports();money(closed.pl.totals.net_profit,reports.pl.totals.net_profit);money(closed.bs.difference,'0.00');money(closed.bs.untransferred_earnings,'0.00');
  const reopened=await c.action('reopen',year);assert.equal(reopened.close_kind,kind);if(kind==='zero_nominal'){assert.equal(reopened.journal_entry_id,null);assert.deepEqual(await c.facts(),before);}else assert.ok(reopened.reopen_document_id);
  const final=await c.reports();money(final.pl.totals.net_profit,reports.pl.totals.net_profit);money(final.bs.difference,'0.00');
  console.log(JSON.stringify({fixture:'year-close-'+mode,organizationId:f.org,kind,profit:close.profit}));
 }finally{await f.close();}
});
