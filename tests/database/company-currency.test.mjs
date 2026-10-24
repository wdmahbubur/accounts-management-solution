import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {createAccountingFixture,request,money,units} from './helpers/accounting-fixture.mjs';
import {fixtureRpcClient} from './helpers/rpc-client.mjs';
import {getIssuedInvoicePdf} from '../../apps/web/server/documents/invoice-pdf-storage.ts';
import {processTrialBalanceExportBatch} from '../../apps/web/server/exports/worker.ts';
import {readPrivateArtifact} from '../../apps/web/server/artifacts/download.ts';
test('country and currency selections remain authoritative through company books and private outputs',{timeout:600_000},async t=>{
 const f=await createAccountingFixture({currency:'USD',country:'US'}),client=fixtureRpcClient(f);let invoice,source;
 const read=async(sql,args=[])=>(await f.rpc(sql,args,f.ids.owner,{readOnly:true})).rows[0].value;
 try{
  await t.test('USD company activates with its selected locale; EUR retries do not create extra companies',async()=>{
   const locale=await read('SELECT public.read_company_locale($1) AS value',[f.org]);
   assert.deepEqual({organization_id:locale.organization_id,country_code:locale.country_code,base_currency:locale.base_currency,timezone:locale.timezone},{organization_id:f.org,country_code:'US',base_currency:'USD',timezone:'Asia/Dhaka'});assert.match(locale.today,/^\d{4}-\d{2}-\d{2}$/);
   const key=randomUUID(),args=['Synthetic EUR books',key];
   const create=()=>f.rpc("SELECT * FROM public.create_company_atomic($1,$1,'DE','EUR','Europe/Berlin',1::smallint,'2025-01-01',$2)",args);
   const receipts=await Promise.all([create(),create()]);assert.equal(receipts[0].rows[0].organization_id,receipts[1].rows[0].organization_id);
   await assert.rejects(f.rpc("SELECT public.create_company_atomic($1,$1,'DE','GBP','Europe/Berlin',1::smallint,'2025-01-01',$2)",args),e=>e.code==='23505');
   for(const[country,currency]of[['ZZ','USD'],['JP','JPY'],['KW','KWD'],['US','XXX']])await assert.rejects(f.rpc("SELECT public.create_company_atomic('Invalid synthetic','Invalid synthetic',$1,$2,'UTC',1::smallint,'2025-01-01',$3)",[country,currency,randomUUID()]),e=>e.code==='22023');
   await assert.rejects(f.rpc('SELECT public.read_company_locale($1)',[f.org],f.ids.outsider),e=>e.code==='P0002');
   await assert.rejects(f.admin.query("UPDATE finance.organizations SET base_currency='EUR' WHERE id=$1",[f.org]),e=>e.code==='23514');
   const clocks=[];for(const timezone of ['Pacific/Kiritimati','Pacific/Honolulu'])clocks.push((await f.rpc("SELECT * FROM public.create_company_atomic('Synthetic calendar company','Synthetic calendar company','US','USD',$1,1::smallint,'2025-01-01',$2)",[timezone,randomUUID()])).rows[0].organization_id);
   const dates=(await f.rpc('SELECT public.read_company_locale($1) AS east,public.read_company_locale($2) AS west',clocks)).rows[0];
   assert.equal(dates.east.timezone,'Pacific/Kiritimati');assert.equal(dates.west.timezone,'Pacific/Honolulu');
   assert.equal(Date.parse(dates.east.today+'T00:00:00Z')-Date.parse(dates.west.today+'T00:00:00Z'),86_400_000,'The same server instant must yield each company’s local calendar day.');
  });
  await t.test('USD invoices, cash collections, bills and payments post exact balanced journals',async()=>{
   await f.posted(f.body('manual_journal','1000.00',{journal_rows:[{account_id:f.accounts['1010'],debit:'1000.00',credit:'0.00',cash_flow_class:'financing',description:'Synthetic USD capital bank'},{account_id:f.accounts['3000'],debit:'0.00',credit:'1000.00',description:'Synthetic USD capital equity'}]}));
   await assert.rejects(f.save(f.body('invoice','123.45',{currency:'EUR'})),e=>e.code==='23514');
   invoice=await f.posted(f.body('invoice','123.45'));const invoiceItem=(await f.openItems(invoice))[0].id;
   await f.posted(f.body('receipt','23.45',{allocation_plan:[{target_open_item_id:invoiceItem,amount:'23.45'}]}));
   const bill=await f.posted(f.body('bill','50.00'));await f.posted(f.body('vendor_payment','20.00',{allocation_plan:[{target_open_item_id:(await f.openItems(bill))[0].id,amount:'20.00'}]}));
   const rows=(await f.admin.query('SELECT sum(debit)::text AS debit,sum(credit)::text AS credit FROM finance.journal_lines WHERE organization_id=$1',[f.org])).rows[0];money(rows.debit,rows.credit);
   const pl=await read("SELECT public.read_profit_loss_snapshot($1,'2025-01-01','2025-12-31',NULL,NULL,NULL) AS value",[f.org]);assert.equal(pl.company.base_currency,'USD');money(pl.data.totals.net_profit,'73.45');
   const bs=await read("SELECT public.read_balance_sheet_snapshot($1,'2025-12-31',NULL) AS value",[f.org]);assert.equal(bs.company.base_currency,'USD');money(bs.data.current.difference,'0.00');
   const ar=await read("SELECT public.read_aging_snapshot($1,'ar','2025-01-31') AS value",[f.org]);assert.equal(ar.company.base_currency,'USD');money(ar.data.net_trade_control_items,'100.00');
   const preview=await read("SELECT public.calculate_document_preview($1::jsonb) AS value",[JSON.stringify({currency:'USD',lines:[{quantity:'3',unit_price:'0.335',discount_amount:'0.00',tax_rate:'0',tax_mode:'exclusive'}]})]);assert.equal(preview.currency,'USD');money(preview.total,'1.01');
  });
  await t.test('USD advance application, linked refund, write-off and reversal preserve company currency',async()=>{
   for(const type of ['customer_advance','advance_application','customer_refund','write_off']){const m=request(type);await f.rpc("SELECT public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,'Synthetic USD policy')",[f.org,m.id,m.key,m.hash,`USD ${type}`,type,f.ownerRole]);}
   const advance=await f.posted(f.body('customer_advance','40.00',{party_id:f.contacts.customer,movement:{cash_account_id:f.cash,direction:'in',amount:'40.00',method:'bank_transfer',reference:'Synthetic USD advance',cash_flow_class:'operating'}}));source=(await f.openItems(advance))[0].id;
   const link=async payload=>{const m=request(payload);return(await f.rpc('SELECT * FROM public.save_linked_settlement_draft($1,NULL,NULL,$2,$3,$4,$5::jsonb)',[f.org,m.id,m.key,m.hash,JSON.stringify(payload)])).rows[0];};
   for(const[type,amount]of[['advance_application','10.00'],['customer_refund','30.00']]){
    const doc=await link({document_type:type,source_open_item_id:source,target_open_item_id:type==='advance_application'?(await f.openItems(invoice))[0].id:null,amount,accounting_date:f.date,description:'Synthetic USD consented accounting correction',...(type==='customer_refund'?{cash_account_id:f.cash,method:'bank_transfer',reference:'Synthetic USD refund',cash_flow_class:'operating'}:{})});
    await f.submit(doc);const preview=(await f.rpc('SELECT public.preview_cash_document_posting($1,$2,$3) AS value',[f.org,doc.document_id,doc.document_version])).rows[0].value;assert.equal(preview.currency,'USD');await f.post(doc);
   }
   const m=request('USD writeoff'),target=(await f.openItems(invoice))[0].id;
   const doc=(await f.rpc("SELECT * FROM public.save_write_off_draft($1,NULL,NULL,$2,$3,$4,$5,$6,$7,'5.00','Synthetic USD small balance correction')",[f.org,m.id,m.key,m.hash,f.date,target,f.accounts['6000']])).rows[0];await f.submit(doc);await f.rpc('SELECT * FROM public.post_write_off_document($1,$2,$3,$4,$5,$6)',[f.org,doc.document_id,doc.document_version,...(()=>{const n=request(doc);return[n.id,n.key,n.hash]})()]);
   const n=request('USD reverse');await f.rpc("SELECT * FROM public.reverse_posted_document($1,$2,'2025-01-20','Synthetic USD reversal correction',$3,$4,$5)",[f.org,doc.document_id,n.id,n.key,n.hash]);
   assert.equal((await f.admin.query("SELECT count(*)::int AS n FROM finance.business_documents WHERE organization_id=$1 AND currency<>'USD'",[f.org])).rows[0].n,0);
  });
  await t.test('issued USD invoice PDF and CSV/PDF/XLSX report exports retain currency and original totals',async()=>{
   const pdf=await getIssuedInvoicePdf(client,{organizationId:f.org,capabilities:['sales.read']},invoice.document_id);assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),'%PDF-');
   const filters={from:'2025-01-01',to:'2025-01-31'},snapshot=(await f.rpc("SELECT public.capture_report_export_snapshot($1,'profit_and_loss',$2::jsonb) AS value",[f.org,JSON.stringify(filters)])).rows[0].value;assert.equal(snapshot.company.base_currency,'USD');
   const jobs=[];for(const format of ['csv','pdf','xlsx']){const m=request(format);jobs.push((await f.rpc("SELECT public.request_report_export($1,$2,$3,$4,'profit_and_loss',$5,$6::jsonb) AS value",[f.org,m.id,m.key,m.hash,format,JSON.stringify({...filters,export_snapshot_id:snapshot.snapshot_id})])).rows[0].value);}
   for(let i=0;i<8;i++){await processTrialBalanceExportBatch(3);const pending=(await f.admin.query("SELECT count(*)::int AS n FROM finance.export_jobs WHERE id=ANY($1::uuid[]) AND status<>'completed'",[jobs.map(j=>j.id)])).rows[0].n;if(!pending)break;}
   for(const job of jobs){const file=await readPrivateArtifact(client,f.org,'exports',job.id),bytes=Buffer.from(await file.bytes.arrayBuffer());
    if(job.format==='csv')assert.ok(bytes.toString().includes('"Currency","USD"'));
    else if(job.format==='pdf')assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    else{const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);const cells=[];workbook.worksheets[0].eachRow(row=>cells.push(...row.values));assert.ok(cells.includes('USD'));}
   }
   if(process.env.AMS_CURRENCY_EVIDENCE_DIR){await writeFile(`${process.env.AMS_CURRENCY_EVIDENCE_DIR}/usd-invoice.pdf`,pdf.bytes);}
   assert.ok(units(snapshot.data.totals.net_profit)>0n);
  });
 }finally{await f.close();}
});
