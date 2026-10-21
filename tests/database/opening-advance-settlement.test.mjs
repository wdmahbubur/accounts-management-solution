import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAccountingFixture,request,money} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {applyAdvanceCommand} from '../../apps/web/server/documents/linked-settlements.ts';

test('cutover advances and individual opening trade credits settle without duplicating cash, revenue or expense',async()=>{
  const f=await createAccountingFixture();
  const call=async(sql,args)=>(await f.rpc(sql,args)).rows[0];
  try{
    const org=(await call("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2025-04-01'::date,$2)",['Synthetic opening settlement '+randomUUID(),randomUUID()])).organization_id;
    const accounts=Object.fromEntries((await f.admin.query('SELECT code,id FROM finance.accounts WHERE organization_id=$1',[org])).rows.map(r=>[r.code,r.id]));
    const customer=randomUUID(),vendor=randomUUID();
    for(const [id,c] of [[customer,true],[vendor,false]])await f.admin.query("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Synthetic cutover contact',$3,$4)",[id,org,c,!c]);
    const amounts=[['1010','10500.00','0.00',null],['1150','4000.00','0.00',vendor],['1100','6000.00','0.00',customer],['2000','500.00','0.00',vendor],['2000','0.00','5000.00',vendor],['2200','0.00','7000.00',customer],['1100','0.00','1000.00',customer],['3000','0.00','8000.00',null]];
    const journal=amounts.map(([code,debit,credit,party],i)=>({account_id:accounts[code],party_id:party,debit,credit,description:'Synthetic imported original balance',cash_flow_class:null,open_item_reference:party?`ORIGINAL-${i}`:null,open_item_due_date:party?'2025-04-15':null}));
    const prior=[['1010','10500.00','0.00'],['1150','4000.00','0.00'],['1100','6000.00','1000.00'],['2000','500.00','5000.00'],['2200','0.00','7000.00'],['3000','0.00','8000.00']].map(([code,debit,credit])=>({account_id:accounts[code],debit,credit}));
    const body=f.body('opening_balance','21000.00',{party_id:null,issue_date:'2025-03-31',accounting_date:'2025-03-31',due_date:null,lines:[],movement:null,journal_rows:journal});
    let m=request(body);const opening=(await call('SELECT public.save_opening_cutover_draft($1,NULL,NULL,$2,$3,$4,$5::jsonb,$6::jsonb,\'[]\'::jsonb,$7) AS data',[org,m.id,m.key,m.hash,JSON.stringify(body),JSON.stringify(prior),'Synthetic original cutover references'])).data;
    const role=(await f.admin.query("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[org])).rows[0].id;
    for(const type of ['opening_balance','advance_application','customer_refund','vendor_refund']){
      m=request(type);await call('SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,$7,$8,1,$9,true,$10)',[org,m.id,m.key,m.hash,`Synthetic opening ${type}`,type,type==='opening_balance'?'0.00':'999999999.00',role,type==='opening_balance','Synthetic sole-operator opening rehearsal policy']);
    }
    const submit=async d=>{const n=request(d);return call('SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)',[org,d.document_id,d.document_version,`documents.submit:${d.document_id}`,n.id,n.key,n.hash]);};
    const approval=await submit(opening);m=request(approval);await call("SELECT * FROM public.decide_financial_approval($1,$2,$3,$4,$5,$6,'approve',NULL)",[org,approval.approval_request_id,`approvals.decide:${approval.approval_request_id}`,m.id,m.key,m.hash]);
    m=request('activate');await call("SELECT public.complete_company_setup($1,$2,$3,$4,'import_opening',false,$5,$6)",[org,m.id,m.key,m.hash,opening.document_id,opening.document_version]);
    const cash=(await call("SELECT public.save_cash_account($1,'Synthetic cutover bank','bank',$2,NULL,NULL,true,false) AS id",[org,accounts['1010']])).id;
    const options=async()=>(await call("SELECT public.read_linked_settlement_options($1,'2025-04-16') AS data",[org])).data;
    const initial=await options();assert.equal(initial.sources.length,4);assert.equal(initial.targets.length,2);assert.ok(initial.sources.every(s=>s.reference.startsWith('ORIGINAL-')));
    const item=(kind,side)=>side==='target'?initial.targets.find(s=>s.control_kind===kind):initial.sources.find(s=>s.control_kind===kind);
    const actor={organizationId:org,userId:f.ids.owner,memberId:(await f.admin.query('SELECT id FROM finance.organization_members WHERE organization_id=$1 AND user_id=$2',[org,f.ids.owner])).rows[0].id,capabilities:['dues.read','dues.allocate','journal.write']};
    const alias=applyAdvanceCommand(fixtureRpcClient(f),opening.document_id),raw={target_open_item_id:item('ar','target').id,amount:'1.00',accounting_date:'2025-04-16',description:'Synthetic explicit opening item alias'};
    const n=request(raw),ctx={actor,requestId:n.id,idempotencyKey:n.key,requestHash:n.hash};
    await assert.rejects(alias.execute(ctx,alias.validate(raw)),e=>e.code==='VALIDATION_FAILED'&&!!e.fields.source_open_item_id);
    const exactRaw={...raw,source_open_item_id:item('customer_advance').id},exactMeta=request(exactRaw);
    const explicit=await alias.execute({...ctx,requestId:exactMeta.id,idempotencyKey:exactMeta.key,requestHash:exactMeta.hash},alias.validate(exactRaw));
    assert.ok(explicit.documentId); // A draft has no capacity or ledger effect.
    const save=async(type,source,target,amount)=>{const payload={document_type:type,source_open_item_id:source.id,target_open_item_id:target?.id??null,amount,accounting_date:'2025-04-16',description:'Synthetic linked opening settlement',...(type==='advance_application'?{}:{cash_account_id:cash,method:'bank_transfer',cash_flow_class:'operating',reference:'Synthetic external opening refund evidence'})};const n=request(payload);return call('SELECT * FROM public.save_linked_settlement_draft($1,NULL,NULL,$2,$3,$4,$5::jsonb)',[org,n.id,n.key,n.hash,JSON.stringify(payload)]);};
    const commands=[['advance_application','customer_advance','ar','4000.00'],['advance_application','vendor_advance','ap','3000.00'],['customer_refund','customer_advance',null,'3000.00'],['vendor_refund','vendor_advance',null,'1000.00'],['customer_refund','ar',null,'1000.00'],['vendor_refund','ap',null,'500.00']];
    for(const [type,source,target,amount] of commands){const d=await save(type,item(source),target?item(target,'target'):null,amount);
      const read=(await call('SELECT public.read_financial_document($1,$2) AS data',[org,d.document_id])).data;assert.equal(read.linked_settlement.source_reference,item(source).reference);
      if(target)assert.equal(read.linked_settlement.target_reference,item(target,'target').reference);
      assert.equal((await submit(d)).state,'approved');const n=request(d);await call('SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)',[org,d.document_id,d.document_version,n.id,n.key,n.hash]);}
    const final=await options();assert.ok(final.sources.every(s=>s.remaining_amount==='0.00'));assert.ok(final.targets.every(s=>s.remaining_amount==='2000.00'));
    for(const kind of ['customer_advance','vendor_advance']){const s=final.sources.find(s=>s.control_kind===kind);money(s.applied_amount,kind==='customer_advance'?'4000.00':'3000.00');money(s.refunded_amount,kind==='customer_advance'?'3000.00':'1000.00');}
    await assert.rejects(save('advance_application',initial.targets.find(s=>s.control_kind==='ar'),item('ap','target'),'1.00'),e=>e.code==='23514');
    const pnl=(await f.admin.query("SELECT count(*)::int AS n FROM finance.journal_lines l JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id WHERE l.organization_id=$1 AND a.account_type IN ('income','expense')",[org])).rows[0].n;assert.equal(pnl,0);
    console.log(JSON.stringify({fixture:'opening-advance-settlement',organizationId:org,sourceItems:4,targetItems:2,linkedCommands:6}));
  }finally{await f.close();}
});
