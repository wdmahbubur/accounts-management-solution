import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAccountingFixture, request, money } from './helpers/accounting-fixture.mjs';

async function fixture() {
  const f=await createAccountingFixture();
  for(const type of ['customer_advance','vendor_advance','advance_application','customer_refund','vendor_refund','customer_credit','vendor_credit']) {
    const m=request(type);
    f.policies[type]=(await f.rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,'Synthetic settlement acceptance policy')",
      [f.org,m.id,m.key,m.hash,`Acceptance ${type}`,type,f.ownerRole])).rows[0];
  }
  f.link=async (payload,current=null,meta=request(payload),actor=f.ids.owner)=>(await f.rpc('SELECT * FROM public.save_linked_settlement_draft($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [f.org,current?.document_id??null,current?.document_version??null,meta.id,meta.key,meta.hash,JSON.stringify(payload)],actor)).rows[0];
  f.options=async date=>(await f.rpc('SELECT public.read_linked_settlement_options($1,$2) AS data',[f.org,date??f.date])).rows[0].data;
  f.reverse=async (doc,date='2025-01-20')=>{const m=request(doc);return(await f.rpc('SELECT * FROM public.reverse_posted_document($1,$2,$3,$4,$5,$6,$7)',[f.org,doc.document_id,date,'Synthetic correction of linked settlement',m.id,m.key,m.hash])).rows[0];};
  f.advance=async (type,amount,date=f.date)=>f.posted(f.body(type,amount,{party_id:f.contacts[type==='customer_advance'?'customer':'vendor'],issue_date:date,accounting_date:date,
    movement:{cash_account_id:f.cash,direction:type==='customer_advance'?'in':'out',amount,method:'bank_transfer',reference:'Synthetic advance evidence',cash_flow_class:'operating'}}));
  f.payload=(type,source,target=null,amount='6000.00',date=f.date)=>({document_type:type,source_open_item_id:source,target_open_item_id:target,amount,accounting_date:date,description:'Synthetic approved linked settlement',
    ...(type==='advance_application'?{}:{cash_account_id:f.cash,reference:'Synthetic external cash evidence',cash_flow_class:'operating',method:'bank_transfer'})});
  f.finish=async doc=>{assert.equal((await f.submit(doc)).state,'approved');return f.post(doc);};
  return f;
}

test('T10 customer application reclassifies with two settlements; unused refund and reversal preserve dated balances',async()=>{
  const f=await fixture();try{
    await f.admin.query("UPDATE finance.contacts SET email='synthetic-snapshot@example.invalid',billing_address=$2::jsonb WHERE organization_id=$1 AND id=$3",[f.org,JSON.stringify({line1:'Synthetic issued address'}),f.contacts.customer]);
    const advance=await f.advance('customer_advance','10000.00');
    const invoice=await f.posted(f.body('invoice','10000.00'));
    const source=(await f.openItems(advance))[0].id,target=(await f.openItems(invoice))[0].id;
    const payload=f.payload('advance_application',source,target),meta=request(payload);
    const app=await f.link(payload,null,meta);assert.deepEqual(await f.link(payload,null,meta),app);
    const saved=(await f.rpc('SELECT public.read_financial_document($1,$2) AS data',[f.org,app.document_id])).rows[0].data;
    assert.equal(saved.party_snapshot.email,'synthetic-snapshot@example.invalid');assert.equal(saved.party_snapshot.billing_address.line1,'Synthetic issued address');
    const preview=(await f.rpc('SELECT public.preview_cash_document_posting($1,$2,$3) AS data',[f.org,app.document_id,app.document_version])).rows[0].data;
    assert.equal(preview.lines.length,2);assert.deepEqual(preview.lines.map(l=>l.account_code),['2200','1100']);
    await f.submit(app);const postMeta=request(app),post=await f.post(app,postMeta);assert.deepEqual(await f.post(app,postMeta),post);const retry=request(app);
    await assert.rejects(f.post(app,retry),/approved|posted/i);
    const rows=await f.journal(app);assert.deepEqual(rows.map(r=>r.code),['2200','1100']);money(rows[0].debit,'6000.00');money(rows[1].credit,'6000.00');
    assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.settlement_allocations WHERE organization_id=$1 AND source_document_id=$2',[f.org,app.document_id])).rows[0].n,2);
    assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.money_movements WHERE organization_id=$1 AND document_id=$2',[f.org,app.document_id])).rows[0].n,0);
    let s=(await f.options()).sources.find(x=>x.id===source);money(s.applied_amount,'6000.00');money(s.remaining_amount,'4000.00');
    const refund=await f.link(f.payload('customer_refund',source,null,'4000.00'));await f.finish(refund);
    assert.deepEqual((await f.journal(refund)).map(r=>r.code),['1010','2200']);
    s=(await f.options()).sources.find(x=>x.id===source);money(s.refunded_amount,'4000.00');money(s.remaining_amount,'0.00');
    await assert.rejects(f.link(f.payload('customer_refund',source,null,'0.01')),/capacity|exceed|balance/i);
    await assert.rejects(f.reverse(advance),/dependent linked/i);
    const allocation=(await f.admin.query('SELECT id FROM finance.settlement_allocations WHERE organization_id=$1 AND source_document_id=$2 LIMIT 1',[f.org,app.document_id])).rows[0].id;
    const m=request('single unapply');await assert.rejects(f.rpc('SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,$7,$8)',[f.org,allocation,`allocations.reverse:${allocation}`,m.id,m.key,m.hash,'2025-01-20','Synthetic partial undo forbidden']),/allocations together/i);
    await f.reverse(refund);await f.reverse(app);
    s=(await f.options('2025-01-20')).sources.find(x=>x.id===source);money(s.remaining_amount,'10000.00');money(s.applied_amount,'0.00');money(s.refunded_amount,'0.00');
    s=(await f.options('2025-01-19')).sources.find(x=>x.id===source);money(s.remaining_amount,'0.00');
    assert.ok(post.journal_entry_id);
  } finally {await f.close();}
});

test('linked plans bind genuine checker decisions; historical future consumption and locked periods reject writes',async()=>{
  const f=await fixture();try{
    const advance=await f.advance('customer_advance','10000.00'),invoice=await f.posted(f.body('invoice','10000.00'));
    const second=await f.posted(f.body('invoice','10000.00'));
    const source=(await f.openItems(advance))[0].id,target=(await f.openItems(invoice))[0].id,other=(await f.openItems(second))[0].id;
    const p=f.policies.advance_application,m=request('checker policy');
    await f.rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,$5,$6,$7,'advance_application','0.00',$8,1,false,true,'Synthetic linked maker checker policy')",[f.org,m.id,m.key,m.hash,p.policy_id,p.row_version,'Acceptance advance_application',f.ownerRole]);
    const decide=async(a,user=f.ids.checker)=>{const n=request(a);return(await f.rpc("SELECT * FROM public.decide_financial_approval($1,$2,$3,$4,$5,$6,'approve',NULL)",[f.org,a.approval_request_id,`approvals.decide:${a.approval_request_id}`,n.id,n.key,n.hash],user)).rows[0];};
    let doc=await f.link(f.payload('advance_application',source,target,'6000.00','2025-01-20'));
    let approval=await f.submit(doc);assert.equal(approval.state,'pending');
    await assert.rejects(decide(approval,f.ids.owner),e=>e.code==='42501');await decide(approval);
    const approvalPreview=(await f.rpc('SELECT public.preview_approval_cash_posting($1,$2,$3) AS data',[f.org,approval.approval_request_id,doc.document_version],f.ids.checker)).rows[0].data;
    assert.deepEqual(approvalPreview.lines.map(l=>l.account_code),['2200','1100']);
    doc=await f.link(f.payload('advance_application',source,other,'6000.00','2025-01-20'),doc);
    await assert.rejects(f.post(doc),e=>['P0001','40001'].includes(e.code));approval=await f.submit(doc);await decide(approval);await f.post(doc);
    // At Jan 15 the full amount appears unused, but Jan 20 already consumes 6000.
    await assert.rejects(f.link(f.payload('customer_refund',source,null,'5000.00','2025-01-15')),e=>e.code==='23P01');
    const refund=await f.link(f.payload('customer_refund',source,null,'4000.00','2025-01-15'));await f.submit(refund);
    const january=(await f.admin.query("SELECT id,row_version FROM finance.accounting_periods WHERE organization_id=$1 AND starts_on='2025-01-01' AND kind='regular'",[f.org])).rows[0],n=request('lock linked');
    await f.rpc('SELECT * FROM public.lock_accounting_period($1,$2,$3,$4,$5)',[f.org,january.id,january.row_version,n.id,'Synthetic close of linked accounting period']);
    await assert.rejects(f.post(refund),e=>['55P03','23514'].includes(e.code));
    await assert.rejects(f.link(f.payload('customer_refund',source,null,'1.00')),e=>['55P03','23514'].includes(e.code));
    await assert.rejects(f.rpc('SELECT * FROM finance.linked_settlement_details'),e=>e.code==='42501');
  }finally{await f.close();}
});

test('T11 supplier application uses AP/advance asset and refund settles unused asset without another expense',async()=>{
  const f=await fixture();try{
    const advance=await f.advance('vendor_advance','10000.00'),bill=await f.posted(f.body('bill','10000.00'));
    const source=(await f.openItems(advance))[0].id,target=(await f.openItems(bill))[0].id;
    const app=await f.link(f.payload('advance_application',source,target));await f.finish(app);
    const rows=await f.journal(app);assert.deepEqual(rows.map(r=>r.code),['1150','2000']);money(rows[0].credit,'6000.00');money(rows[1].debit,'6000.00');
    const refund=await f.link(f.payload('vendor_refund',source,null,'4000.00'));await f.finish(refund);
    const cash=await f.journal(refund);assert.deepEqual(cash.map(r=>r.code),['1010','1150']);money(cash[0].debit,'4000.00');money(cash[1].credit,'4000.00');
    const s=(await f.options()).sources.find(x=>x.id===source);money(s.remaining_amount,'0.00');money(s.applied_amount,'6000.00');money(s.refunded_amount,'4000.00');
  }finally{await f.close();}
});

test('T13 linked trade credit refunds use AR/AP and reject excess, wrong party, wrong control, tenant and ordinary-role bypasses',async()=>{
  const f=await fixture();try{
    const advance=await f.advance('customer_advance','10000.00'),invoice=await f.posted(f.body('invoice','10000.00'));
    const bill=await f.posted(f.body('bill','10000.00'));const source=(await f.openItems(advance))[0].id;
    await assert.rejects(f.link(f.payload('advance_application',source,(await f.openItems(bill))[0].id)),/compatible/i);
    await assert.rejects(f.link(f.payload('vendor_refund',source)),/supplier refund/i);
    await assert.rejects(f.link(f.payload('customer_refund',source,null,'10000.01')),/capacity|exceed/i);
    await assert.rejects(f.link(f.payload('customer_refund',randomUUID())),/unavailable/i);
    const otherOrg=(await f.rpc("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,'2025-01-01',$2)",['Synthetic cross-company settlement '+randomUUID(),randomUUID()])).rows[0].organization_id;
    let m=request('activate other company');await f.rpc("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)",[otherOrg,m.id,m.key,m.hash]);
    m=request('cross-company source');await assert.rejects(f.rpc('SELECT * FROM public.save_linked_settlement_draft($1,NULL,NULL,$2,$3,$4,$5::jsonb)',[otherOrg,m.id,m.key,m.hash,JSON.stringify(f.payload('customer_refund',source))]),e=>e.code==='P0002');
    await assert.rejects(f.link(f.payload('customer_refund',source),null,request('billing'),f.ids.billing),/permission|capability/i);
    await assert.rejects(f.link(f.payload('customer_refund',source),null,request('outsider'),f.ids.outsider),/member|permission|unavailable/i);
    await assert.rejects(f.link({...f.payload('customer_refund',source),reference:' '}),e=>e.code==='22023');
    await assert.rejects(f.link({...f.payload('customer_refund',source),method:'not-a-method'}),e=>e.code==='22023');
    const cash=(await f.rpc("SELECT public.save_cash_account($1,'Synthetic empty refund cash','cash',$2,NULL,NULL,false,false) AS id",[f.org,f.accounts['1000']])).rows[0].id;
    const cashRefund=await f.link({...f.payload('customer_refund',source,null,'1.00'),cash_account_id:cash,method:'cash'});await f.submit(cashRefund);
    await assert.rejects(f.post(cashRefund),e=>['23514','23P01'].includes(e.code));assert.equal((await f.journal(cashRefund)).length,0);
    for(const [original,type,refundType] of [[invoice,'customer_credit','customer_refund'],[bill,'vendor_credit','vendor_refund']]) {
      const orig=(await f.rpc('SELECT public.read_financial_document($1,$2) AS data',[f.org,original.document_id])).rows[0].data;
      const line=f.line('2000.00',f.accounts[type==='customer_credit'?'4000':'6000']);line.original_line_id=orig.lines[0].id;
      const credit=await f.posted(f.body(type,'2000.00',{party_id:orig.party_id,trade:{original_document_id:original.document_id,recognition_mode:'earned_or_incurred',performance_confirmed:true},lines:[line]}));
      const item=(await f.openItems(credit))[0].id;
      const refund=await f.link(f.payload(refundType,item,null,'2000.00'));await f.finish(refund);
      const journal=await f.journal(refund);assert.deepEqual(journal.map(x=>x.code),['1010',type==='customer_credit'?'1100':'2000']);
      await assert.rejects(f.link(f.payload(refundType,item,null,'0.01')),/capacity|exceed/i);
    }
  }finally{await f.close();}
});

test('T36 material edits supersede settlement approvals; S08 application/refund different-key race cannot overspend advance',async()=>{
  const f=await fixture();try{
    const advance=await f.advance('customer_advance','10000.00'),invoice=await f.posted(f.body('invoice','10000.00'));
    const source=(await f.openItems(advance))[0].id,target=(await f.openItems(invoice))[0].id;
    const a=await f.link(f.payload('advance_application',source,target));await f.submit(a);
    const edited=await f.link(f.payload('advance_application',source,target,'6001.00'),a);
    assert.equal(edited.document_version,2);await assert.rejects(f.post(a),/stale|approved/i);
    const app=await f.link(f.payload('advance_application',source,target,'6000.00'),edited);
    const refund=await f.link(f.payload('customer_refund',source,null,'6000.00'));
    await f.submit(app);await f.submit(refund);
    const results=await Promise.allSettled([f.post(app),f.post(refund)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.match(results.find(x=>x.status==='rejected').reason.message,/capacity|exceed/i);
    const s=(await f.options()).sources.find(x=>x.id===source);money(s.remaining_amount,'4000.00');
    const journals=(await f.admin.query('SELECT count(*)::int AS n FROM finance.journal_entries WHERE organization_id=$1 AND source_document_id=ANY($2::uuid[])',[f.org,[app.document_id,refund.document_id]])).rows[0].n;assert.equal(journals,1);
    // A backdated draft must also respect consumption at the later boundary.
    await assert.rejects(f.link(f.payload('customer_refund',source,null,'4000.01')),/capacity|exceed/i);
  }finally{await f.close();}
});
