import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createAccountingFixture,request,money} from './helpers/accounting-fixture.mjs';

test('historical opening due dates retain aging evidence without moving ledger availability', {timeout:300000}, async t=>{
 const f=await createAccountingFixture();
 const call=async(sql,args,actor=f.ids.owner)=>(await f.rpc(sql,args,actor)).rows[0];
 let org,accounts,opening,body,prior,customer,vendor;
 const save=async(payload,current=null)=>{const m=request(payload);return(await call('SELECT public.save_opening_cutover_draft($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,\'[]\'::jsonb,$9) AS value',[org,current?.document_id??null,current?.document_version??null,m.id,m.key,m.hash,JSON.stringify(payload),JSON.stringify(prior),'Synthetic original unpaid invoice/bill references'])).value;};
 const submit=async doc=>{const m=request(doc);return call('SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)',[org,doc.document_id,doc.document_version,`documents.submit:${doc.document_id}`,m.id,m.key,m.hash]);};
 const approve=async doc=>{const approval=await submit(doc),m=request(approval);await call("SELECT * FROM public.decide_financial_approval($1,$2,$3,$4,$5,$6,'approve',NULL)",[org,approval.approval_request_id,`approvals.decide:${approval.approval_request_id}`,m.id,m.key,m.hash]);};
 const activate=async(doc,m=request(doc))=>(await call("SELECT public.complete_company_setup($1,$2,$3,$4,'import_opening',false,$5,$6) AS value",[org,m.id,m.key,m.hash,doc.document_id,doc.document_version])).value;
 const aging=async(kind,date)=>(await call('SELECT public.read_aging_snapshot($1,$2,$3) AS value',[org,kind,date])).value.data;
 try{
  org=(await call("SELECT * FROM public.create_company_atomic($1,$1,'US','USD','America/New_York',1::smallint,'2026-10-01'::date,$2)",['Synthetic overdue opening '+randomUUID(),randomUUID()])).organization_id;
  accounts=Object.fromEntries((await f.admin.query('SELECT code,id FROM finance.accounts WHERE organization_id=$1',[org])).rows.map(r=>[r.code,r.id]));
  customer=randomUUID();vendor=randomUUID();
  for(const [id,c]of[[customer,true],[vendor,false]])await f.admin.query("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Synthetic original balance party',$3,$4)",[id,org,c,!c]);
  const details=[['1100','100.00','0.00',customer,'AR-OVERDUE','2026-08-31'],['1100','25.00','0.00',customer,'AR-CURRENT','2026-09-30'],['1100','40.00','0.00',customer,'AR-FUTURE','2026-10-20'],['1100','10.00','0.00',customer,'AR-LEAP','2024-02-29'],['2000','0.00','60.00',vendor,'AP-OVERDUE','2026-09-15'],['2000','0.00','15.00',vendor,'AP-CURRENT','2026-09-30'],['2000','0.00','20.00',vendor,'AP-FUTURE','2026-10-20'],['2000','0.00','5.00',vendor,'AP-LEAP','2024-02-29']];
  const journal=details.map(([code,debit,credit,party,ref,due])=>({account_id:accounts[code],party_id:party,cost_center_id:null,debit,credit,description:'Remaining unpaid original balance only',cash_flow_class:null,open_item_reference:ref,open_item_due_date:due}));
  journal.push({account_id:accounts['1010'],party_id:null,debit:'500.00',credit:'0.00',description:'Imported bank balance',cash_flow_class:null},{account_id:accounts['3000'],party_id:null,debit:'0.00',credit:'575.00',description:'Imported capital',cash_flow_class:null});
  prior=[['1100','175.00','0.00'],['2000','0.00','100.00'],['1010','500.00','0.00'],['3000','0.00','575.00']].map(([code,debit,credit])=>({account_id:accounts[code],debit,credit}));
  body=f.body('opening_balance','675.00',{currency:'USD',party_id:null,issue_date:'2026-09-30',accounting_date:'2026-09-30',due_date:null,lines:[],movement:null,journal_rows:journal});
  opening=await save({...body,journal_rows:body.journal_rows.map(row=>row.open_item_reference==='AP-OVERDUE'?{...row,open_item_due_date:'2026-09-16'}:row)});
  const ownerRole=(await f.admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[org])).rows[0].id,m=request('opening policy');
  await call("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,'Synthetic reviewed overdue opening','opening_balance','0.00',$5,1,true,true,'Explicit synthetic sole operator exception')",[org,m.id,m.key,m.hash,ownerRole]);
  await t.test('changing a historical due date invalidates approval and failed activation leaves no journal',async()=>{
   await approve(opening);const old=opening;opening=await save(body,opening);assert.equal(opening.document_version,old.document_version+1);
   await assert.rejects(()=>activate(old),e=>['40001','23514'].includes(e.code));
   await assert.rejects(()=>activate(opening),e=>e.code==='P0001'&&/approve/.test(e.message));
   assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.journal_entries WHERE organization_id=$1',[org])).rows[0].n,0);
  });
  await t.test('overdue opening commits with exact references, same cutover date and one idempotent journal',async()=>{
   await approve(opening);const meta=request(opening),receipt=await activate(opening,meta);assert.deepEqual(await activate(opening,meta),receipt);
   const rows=(await f.admin.query('SELECT reference,issue_date,due_date,original_amount::text FROM finance.open_items WHERE organization_id=$1 ORDER BY reference',[org])).rows;
   assert.equal(rows.length,8);for(const [,, , ,ref,due]of details){const row=rows.find(r=>r.reference===ref);assert.equal(row.due_date,due);assert.equal(row.issue_date,'2026-09-30');}
   const facts=(await f.admin.query("SELECT count(*)::int AS journals,min(accounting_date)::text AS first_date,max(accounting_date)::text AS last_date FROM finance.journal_entries WHERE organization_id=$1 AND state='posted'",[org])).rows[0];assert.deepEqual(facts,{journals:1,first_date:'2026-09-30',last_date:'2026-09-30'});
   assert.equal((await f.admin.query("SELECT count(*)::int AS n FROM finance.journal_lines l JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id WHERE l.organization_id=$1 AND a.account_type IN ('income','expense')",[org])).rows[0].n,0);
  });
  await t.test('pre-cutover history is empty and current/future/leap aging reconciles at cutover and afterwards',async()=>{
   for(const [kind,total,current,future,overdue,leap]of[['ar','175.00','25.00','40.00','100.00','10.00'],['ap','100.00','15.00','20.00','60.00','5.00']]){
    const before=await aging(kind,'2026-09-29');money(before.net_trade_control_items,'0.00');money(before.trade_control_ledger,'0.00');
    const at=await aging(kind,'2026-09-30');money(at.net_trade_control_items,total);money(at.net_bridge_difference,'0.00');money(at.buckets.days_1_30,overdue);money(at.buckets.days_91_plus,leap);money(at.buckets.not_due,kind==='ar'?'65.00':'35.00');
    const after=await aging(kind,'2026-10-01');money(after.net_trade_control_items,total);money(after.net_bridge_difference,'0.00');money(after.buckets.not_due,future);assert.ok(after.items.some(row=>row.reference===`${kind.toUpperCase()}-LEAP`&&row.due_date==='2024-02-29'));assert.ok(after.items.some(row=>row.reference===`${kind.toUpperCase()}-CURRENT`&&row.bucket==='days_1_30'&&row.residual===current));
   }
  });
  await t.test('foreign actors cannot inspect the opening evidence or aging, and ordinary roles cannot rewrite dates',async()=>{
   await assert.rejects(()=>call('SELECT public.read_aging_snapshot($1,\'ar\',\'2026-10-01\')',[org],f.ids.outsider),e=>e.code==='42501');
   await assert.rejects(()=>call('SELECT public.read_opening_cutover_summary($1,$2)',[org,opening.document_id],f.ids.outsider),e=>e.code==='42501');
   await assert.rejects(()=>f.rpc("UPDATE finance.open_items SET due_date='2026-10-01' WHERE organization_id=$1",[org]),e=>['42501','23514'].includes(e.code));
  });
  await t.test('ordinary control journals still reject pre-availability due dates',async()=>{
   const draft=await f.save(f.body('manual_journal','1.00',{journal_rows:[
    {account_id:f.accounts['1100'],party_id:f.contacts.customer,debit:'1.00',credit:'0.00',description:'Normal source must retain date ordering',open_item_reference:'NORMAL-ORDERING',open_item_due_date:'2025-01-01'},
    {account_id:f.accounts['3000'],debit:'0.00',credit:'1.00',description:'Synthetic normal control counterline'}]}));
   assert.equal((await f.submit(draft)).state,'approved');await assert.rejects(()=>f.post(draft),e=>e.code==='22023');
   assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.journal_entries WHERE organization_id=$1',[f.org])).rows[0].n,0);
  });
  await t.test('partial collection settles overdue opening capacity only after cutover and preserves dated aging',async()=>{
   const cash=(await call("SELECT public.save_cash_account($1,'Synthetic opening bank','bank',$2,NULL,NULL,true,false) AS id",[org,accounts['1010']])).id;
   const policy=request('collection policy');await call("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,'Synthetic collection policy','receipt','999999999.00',$5,1,false,true,'Synthetic collection below threshold')",[org,policy.id,policy.key,policy.hash,ownerRole]);
   const debit=(await f.rpc("SELECT id FROM finance.open_items WHERE organization_id=$1 AND reference='AR-OVERDUE'",[org])).rows[0].id;
   const payload=f.body('receipt','10.00',{currency:'USD',party_id:customer,issue_date:'2026-10-01',accounting_date:'2026-10-01',movement:{cash_account_id:cash,direction:'in',amount:'10.00',method:'bank_transfer',reference:'Synthetic opening collection',cash_flow_class:'operating'},allocation_plan:[{target_open_item_id:debit,amount:'10.00'}]}),meta=request(payload);
   const early={...payload,issue_date:'2026-09-29',accounting_date:'2026-09-29'},earlyMeta=request(early);
   await assert.rejects(()=>call('SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)',[org,earlyMeta.id,earlyMeta.key,earlyMeta.hash,JSON.stringify(early)]),e=>['23514','22023'].includes(e.code));
   const receipt=await call('SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)',[org,meta.id,meta.key,meta.hash,JSON.stringify(payload)]);assert.equal((await submit(receipt)).state,'approved');
   const post=request(receipt);await call('SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)',[org,receipt.document_id,receipt.document_version,post.id,post.key,post.hash]);
   assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.settlement_allocations WHERE organization_id=$1 AND debit_open_item_id=$2',[org,debit])).rows[0].n,1);
   money((await aging('ar','2026-09-30')).net_trade_control_items,'175.00');const after=await aging('ar','2026-10-01');money(after.net_trade_control_items,'165.00');money(after.net_bridge_difference,'0.00');assert.equal(after.items.find(row=>row.reference==='AR-OVERDUE').residual,'90.00');
  });
  console.log(JSON.stringify({fixture:'historical-opening-dates',organizationId:org,sourceDocumentId:opening.document_id,cutover:'2026-09-30',ar:'175.00',ap:'100.00',nominalLines:0}));
 }finally{await f.close();}
});
