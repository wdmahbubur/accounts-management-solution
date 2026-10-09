// Explicit isolated-only verifier. New fixtures; no reset, browser-org changes or provider calls.
// Privileged SQL seeds identities/roles/contacts/bank only. All financial commands use ams_app_login.
// AMS_DATABASE_TESTS=isolated node tests/database/credit-application-workflow.mjs
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {neonConfig,Pool,types} from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import {bangladeshDate} from "../../apps/web/lib/date.ts";

assert.equal(process.env.AMS_DATABASE_TESTS,"isolated","Explicitly select an isolated test database.");
const ownerUrl=process.env.TEST_DATABASE_URL??process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL;
const runtimeUrl=process.env.TEST_DATABASE_RUNTIME_URL??process.env.DATABASE_RUNTIME_URL;
let sameTarget=false;
try {const a=new URL(ownerUrl),b=new URL(runtimeUrl);sameTarget=a.hostname===b.hostname&&a.pathname===b.pathname&&decodeURIComponent(b.username)==="ams_app_login";}catch{/* Never echo configuration. */}
assert.ok(sameTarget,"Select the isolated owner and actual ams_app_login on the same database.");
neonConfig.webSocketConstructor=WebSocket;types.setTypeParser(types.builtins.DATE,value=>value);
const ownerPool=new Pool({connectionString:ownerUrl,max:1,connectionTimeoutMillis:30000});
const runtimePool=new Pool({connectionString:runtimeUrl,max:2,connectionTimeoutMillis:30000});
const ids={owner:randomUUID(),reader:randomUUID(),sales:randomUUID(),purchases:randomUUID(),dues:randomUUID(),noRead:randomUUID(),outsider:randomUUID()};
const run=randomUUID(),today=bangladeshDate(),past=shift(today,-2),future=shift(today,10),later=shift(today,11);
let org,foreignOrg,party,otherParty,foreignParty,cash,accounts,checks=0,stage="connect";
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report=(check,details={})=>{checks++;process.stdout.write(`${JSON.stringify({check,status:"passed",...details})}\n`);};
const ownerQuery=(sql,args=[])=>ownerPool.query(sql,args);
function shift(date,days){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
async function actor(user,work,readOnly=false){
  const client=await runtimePool.connect();
  try{await client.query(readOnly?"BEGIN READ ONLY":"BEGIN");await client.query("SET LOCAL statement_timeout='30s'");await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[user]);const result=await work(client);await client.query(readOnly?"ROLLBACK":"COMMIT");return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
async function expectSql(code,work){await assert.rejects(work,error=>error?.code===code);}
async function evidence(){return(await ownerQuery(`SELECT jsonb_build_object(
  'sources',(SELECT jsonb_agg(jsonb_build_array(id,state,version,material_digest,document_number,party_snapshot) ORDER BY id) FROM finance.business_documents WHERE organization_id=$1),
  'sequences',(SELECT jsonb_agg(jsonb_build_array(document_type,next_value) ORDER BY document_type) FROM finance.document_sequences WHERE organization_id=$1),
  'journals',(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1),'lines',(SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1),
  'journal_facts',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM finance.journal_entries j WHERE organization_id=$1),
  'line_facts',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM finance.journal_lines l WHERE organization_id=$1),
  'movements',(SELECT count(*) FROM finance.money_movements WHERE organization_id=$1),'items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),
  'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),'unapplies',(SELECT count(*) FROM finance.allocation_reversals WHERE organization_id=$1),
  'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),
  'requests',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1)) AS data`,[org])).rows[0].data;}
async function options(document,date=today,user=ids.owner,organization=org){
  const before=await evidence();const result=await actor(user,c=>c.query("SELECT public.read_credit_application_options($1,$2,$3::date) AS data",[organization,document.document_id,date]),true);
  assert.deepEqual(await evidence(),before);return result.rows[0].data;
}
function trade(type,{quantity="10.000000",date=past,original=null,originalLine=null,contact=party,account=null}={}){
  const purchase=["bill","vendor_credit"].includes(type);
  return {document_type:type,party_id:contact,issue_date:date,accounting_date:date,due_date:date,description:`Synthetic credit application ${type}`,external_reference:null,currency:"BDT",
    rounding_adjustment:"0.00",rounding_reason:null,rounding_account_id:null,
    trade:{recognition_mode:"earned_or_incurred",performance_confirmed:true,original_document_id:original,supplier_invoice_date:purchase?date:null,supplier_invoice_key:purchase?`CREDIT-QA-${randomUUID()}`:null},
    movement:null,transfer:null,lines:[{id:null,item_id:null,original_line_id:originalLine,description:"Synthetic original service",quantity,unit_price:"10.000000",discount_amount:"0.00",account_id:account??accounts[purchase?"6000":"4000"],cost_center_id:null,tax_code_id:null,tax_mode:"exclusive",cash_flow_class:null}],journal_rows:[],allocation_plan:[]};
}
async function save(body,organization=org){const key=randomUUID();return(await actor(ids.owner,c=>c.query("SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)",
  [organization,`credit_${key}`,key,hash(body),JSON.stringify(body)]))).rows[0];}
async function posted(body,organization=org){
  const document=await save(body,organization),submitKey=randomUUID(),postKey=randomUUID();
  const review=(await actor(ids.owner,c=>c.query("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)",
    [organization,document.document_id,document.document_version,`documents.submit:${document.document_id}`,`credit_${submitKey}`,submitKey,hash(document)]))).rows[0];assert.equal(review.state,"approved");
  await actor(ids.owner,c=>c.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)",[organization,document.document_id,document.document_version,`credit_${postKey}`,postKey,hash(document)]));return document;
}
async function line(document,organization=org){return(await ownerQuery("SELECT id FROM finance.document_lines WHERE organization_id=$1 AND document_id=$2 ORDER BY line_no",[organization,document.document_id])).rows[0].id;}
async function item(document,organization=org){const rows=(await ownerQuery(`SELECT oi.id FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
  JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id WHERE j.organization_id=$1 AND j.source_document_id=$2`,[organization,document.document_id])).rows;assert.equal(rows.length,1);return rows[0].id;}
async function credit(original,type="customer_credit",quantity="4.000000",date=past){return posted(trade(type,{quantity,date,original:original.document_id,originalLine:await line(original)}));}
async function allocate(debit,creditId,amount,date=today,{user=ids.owner,organization=org,key=randomUUID(),digest=hash([debit,creditId,amount,date])}={}){
  return(await actor(user,c=>c.query("SELECT * FROM public.allocate_open_items($1,$2,$3,$4,$5,$6,$7,$8::date)",
    [organization,`credit_${key}`,key,digest,debit,creditId,amount,date]))).rows[0];
}
async function unapply(allocation,date){const key=randomUUID();return actor(ids.owner,c=>c.query("SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,$7::date,$8)",
  [org,allocation.allocation_id,`allocations.reverse:${allocation.allocation_id}`,`credit_${key}`,key,hash([allocation,date]),date,"Synthetic dated credit application unapply"]));}
async function reverse(document){const key=randomUUID();return actor(ids.owner,c=>c.query("SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)",
  [org,document.document_id,today,"Synthetic credit application correction",`credit_${key}`,key,hash(document)]));}
async function settleWithCash(original,purchase){
  const body=trade(purchase?"vendor_payment":"receipt");body.trade=null;body.lines=[];body.due_date=null;
  body.movement={cash_account_id:cash,direction:purchase?"out":"in",amount:"100.00",method:"bank_transfer",reference:"Synthetic settlement only",cash_flow_class:"operating"};
  body.allocation_plan=[{target_open_item_id:await item(original),amount:"100.00"}];return posted(body);
}
async function policy(organization,type){const ownerRole=(await ownerQuery("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[organization])).rows[0].id,key=randomUUID();
  await actor(ids.owner,c=>c.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,$8)",
    [organization,`credit_${key}`,key,hash(type),`Credit application QA ${type}`,type,ownerRole,"Synthetic below-threshold test policy"]));
}

try {
  const role=(await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole,pg_has_role(current_user,'ams_runtime','member') AS runtime_member FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  assert.equal(role.current_user,"ams_app_login");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolcreaterole,false);assert.equal(role.runtime_member,true);
  assert.ok((await ownerQuery("SELECT to_regprocedure('public.read_credit_application_options(uuid,uuid,date)') IS NOT NULL AS ready")).rows[0].ready,"Install reviewed migration 0094 before running this verifier.");
  stage="isolated fixture setup";
  for(const [name,id] of Object.entries(ids)){
    await ownerQuery("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())",[id,`credit-${id}@example.invalid`,`Credit QA ${name}`,"$argon2id$synthetic-unusable-test-hash"]);
    await ownerQuery("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')",[id,`Credit QA ${name}`]);
  }
  for(const foreign of [false,true]){
    const organization=(await actor(ids.owner,c=>c.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)",
      [`${foreign?"Foreign ":""}Credit Application QA ${run}`,`${today.slice(0,4)}-01-01`,randomUUID()]))).rows[0].organization_id;
    const key=randomUUID();await actor(ids.owner,c=>c.query("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)",[organization,`credit_${key}`,key,hash("zero")]));
    if(foreign)foreignOrg=organization;else org=organization;
  }
  for(const [user,name,permissions] of [[ids.reader,"Credit reader",["sales.read","purchases.read","dues.read"]],[ids.sales,"Sales settlement",["sales.read","dues.read","dues.allocate"]],
    [ids.purchases,"Purchase settlement",["purchases.read","dues.read","dues.allocate"]],[ids.dues,"Dues only",["dues.read","dues.allocate"]],[ids.noRead,"Allocate only",["dues.allocate"]]]){
    const member=randomUUID(),roleId=randomUUID();await ownerQuery("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)",[member,org,user,name]);
    await ownerQuery("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)",[roleId,org,name]);
    await ownerQuery("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])",[org,roleId,permissions]);
    await ownerQuery("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)",[org,member,roleId]);
  }
  accounts=Object.fromEntries((await ownerQuery("SELECT code,id FROM finance.accounts WHERE organization_id=$1",[org])).rows.map(row=>[row.code,row.id]));
  party=randomUUID();otherParty=randomUUID();foreignParty=randomUUID();cash=randomUUID();
  for(const [id,organization,name] of [[party,org,"Credit party one"],[otherParty,org,"Credit party two"],[foreignParty,foreignOrg,"Foreign credit party"]]){
    await ownerQuery("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,$3,true,true)",[id,organization,name]);
  }
  await ownerQuery("INSERT INTO finance.cash_accounts(id,organization_id,name,kind,account_id,is_cash_equivalent,allow_negative_balance) VALUES($1,$2,'Synthetic credit bank','bank',$3,true,false)",[cash,org,accounts["1010"]]);
  for(const type of ["invoice","bill","customer_credit","vendor_credit","receipt","vendor_payment"])await policy(org,type);
  await policy(foreignOrg,"invoice");
  report("actual restricted login and new runtime-created/zero-activated companies; privileged identity/role/contact/bank fixtures disclosed",{organization_id:org});

  stage="customer credit application and same-key race";
  const invoice=await posted(trade("invoice")),customerCredit=await credit(invoice);
  const initial=await options(customerCredit,today,ids.sales);assert.equal(initial.original_document_id,invoice.document_id);assert.equal(initial.status,"available");assert.equal(initial.available_amount,"40.00");
  assert.equal(initial.debit_open_item_id,await item(invoice));assert.equal(initial.credit_open_item_id,await item(customerCredit));
  const before=await evidence(),key=randomUUID();
  const replay=await Promise.all([allocate(initial.debit_open_item_id,initial.credit_open_item_id,"30.00",today,{user:ids.sales,key}),allocate(initial.debit_open_item_id,initial.credit_open_item_id,"30.00",today,{user:ids.sales,key})]);
  assert.deepEqual(replay[0],replay[1]);const after=await evidence();
  for(const field of ["sources","sequences","journals","lines","journal_facts","line_facts","movements","items","outbox"])assert.deepEqual(after[field],before[field],field);
  assert.equal(after.allocations,before.allocations+1);assert.equal(after.audit,before.audit+1);assert.equal(after.requests,before.requests+1);
  assert.deepEqual(await allocate(initial.debit_open_item_id,initial.credit_open_item_id,"30.00",today,{user:ids.sales,key}),replay[0]);assert.deepEqual(await evidence(),after);
  await expectSql("23505",()=>allocate(initial.debit_open_item_id,initial.credit_open_item_id,"31.00",today,{user:ids.sales,key}));
  const partial=await options(customerCredit);assert.equal(partial.credit_residual_amount,"10.00");assert.equal(partial.original_residual_amount,"70.00");assert.equal(partial.available_amount,"10.00");assert.equal(partial.allocations[0].counter_document_id,invoice.document_id);
  report("customer credit applies only selected money once across simultaneous same-key retries, retains issued/journal/cash facts and exposes exact residuals");

  stage="vendor credit application and zero original";
  const bill=await posted(trade("bill")),vendorCredit=await credit(bill,"vendor_credit","10.000000"),vendorOptions=await options(vendorCredit,today,ids.purchases);
  assert.equal(vendorOptions.debit_open_item_id,await item(vendorCredit));assert.equal(vendorOptions.credit_open_item_id,await item(bill));
  await allocate(vendorOptions.debit_open_item_id,vendorOptions.credit_open_item_id,"100.00",today,{user:ids.purchases});
  const closed=await options(vendorCredit);assert.equal(closed.credit_residual_amount,"0.00");assert.equal(closed.original_residual_amount,"0.00");assert.equal(closed.available_amount,"0.00");assert.equal(closed.status,"already_allocated");
  await expectSql("23P01",()=>allocate(vendorOptions.debit_open_item_id,vendorOptions.credit_open_item_id,"0.01"));
  report("vendor credit uses AP debit against its original bill credit; exact full application reaches zero and rejects excess");

  stage="permission and scope negatives";
  for(const user of [ids.noRead,ids.outsider])await expectSql("42501",()=>options(customerCredit,today,user));
  for(const [document,user] of [[customerCredit,ids.purchases],[vendorCredit,ids.sales],[customerCredit,ids.dues]])await expectSql("P0002",()=>options(document,today,user));
  await expectSql("42501",()=>allocate(initial.debit_open_item_id,initial.credit_open_item_id,"1.00",today,{user:ids.reader}));
  await expectSql("22023",()=>options(invoice));await expectSql("P0002",()=>options(customerCredit,today,ids.owner,foreignOrg));
  const wrongInvoice=await posted(trade("invoice",{contact:otherParty})),wrongItem=await item(wrongInvoice);
  const foreignAccount=(await ownerQuery("SELECT id FROM finance.accounts WHERE organization_id=$1 AND code='4000'",[foreignOrg])).rows[0].id;
  const foreignInvoice=await posted(trade("invoice",{contact:foreignParty,account:foreignAccount}),foreignOrg),foreignItem=await item(foreignInvoice,foreignOrg);
  const beforeInvalid=await evidence();
  await expectSql("22023",()=>allocate(wrongItem,initial.credit_open_item_id,"1.00"));
  await expectSql("22023",()=>allocate(initial.credit_open_item_id,initial.debit_open_item_id,"1.00"));
  await expectSql("22023",()=>allocate(vendorOptions.debit_open_item_id,initial.credit_open_item_id,"1.00"));
  await expectSql("P0002",()=>allocate(foreignItem,initial.credit_open_item_id,"1.00"));
  await expectSql("P0002",()=>allocate(initial.debit_open_item_id,initial.credit_open_item_id,"1.00",today,{organization:foreignOrg}));
  assert.deepEqual(await evidence(),beforeInvalid);
  report("read and allocation permissions, source family, wrong party, reversed sides, mixed AR/AP and cross-company targets fail without effects");

  stage="settled originals retain unused credit";
  for(const purchase of [false,true]){
    const original=await posted(trade(purchase?"bill":"invoice"));await settleWithCash(original,purchase);
    const availableCredit=await credit(original,purchase?"vendor_credit":"customer_credit"),value=await options(availableCredit);
    assert.equal(value.credit_residual_amount,"40.00");assert.equal(value.original_residual_amount,"0.00");assert.equal(value.available_amount,"0.00");assert.equal(value.status,"original_settled");
    await expectSql("23P01",()=>allocate(value.debit_open_item_id,value.credit_open_item_id,"0.01"));
  }
  report("cash-settled invoice and bill originals stay at zero; later credit remains unused and cannot be falsely applied to them");

  stage="temporal capacity and reversed credit";
  const timedInvoice=await posted(trade("invoice")),timedCredit=await credit(timedInvoice),timed=await options(timedCredit);
  const futureAllocation=await allocate(timed.debit_open_item_id,timed.credit_open_item_id,"30.00",future);
  const capacity=await options(timedCredit);assert.equal(capacity.credit_residual_amount,"40.00");assert.equal(capacity.original_residual_amount,"100.00");assert.equal(capacity.available_amount,"10.00");assert.equal(capacity.allocations[0].effective_date,future);
  await expectSql("23P01",()=>allocate(timed.debit_open_item_id,timed.credit_open_item_id,"10.01"));
  await unapply(futureAllocation,later);assert.equal((await options(timedCredit)).available_amount,"10.00");assert.equal((await options(timedCredit,later)).available_amount,"40.00");assert.equal((await options(timedCredit)).allocations[0].reversed_on,later);
  const futureInvoice=await posted(trade("invoice")),futureCredit=await credit(futureInvoice,"customer_credit","4.000000",future),notYet=await options(futureCredit);
  assert.equal(notYet.status,"not_yet_effective");assert.equal(notYet.minimum_date,future);assert.equal(notYet.credit_residual_amount,null);assert.equal(notYet.available_amount,"0.00");
  const reversalInvoice=await posted(trade("invoice")),reversalCredit=await credit(reversalInvoice);await reverse(reversalCredit);
  const reversed=await options(reversalCredit,today,ids.sales);assert.equal(reversed.status,"reversed");assert.equal(reversed.available_amount,"0.00");assert.equal(reversed.allocations[0].counter_document_id,null);
  report("credit options honor future allocation/unapply boundaries, future source dates and linked reversals without leaking generic reversal identity");
  process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:org,invoice_id:invoice.document_id,customer_credit_id:customerCredit.document_id,bill_id:bill.document_id,vendor_credit_id:vendorCredit.document_id,note:"New synthetic fixtures retained. Privileged seeding is separate; all financial commands and permission-sensitive reads use the actual restricted login. Tax/deferred-credit, browser and provider acceptance are outside this verifier."})}\n`);
}catch(error){process.stderr.write(`${JSON.stringify({result:"failed",checks,stage,organization_id:org,code:typeof error?.code==="string"?error.code:undefined,message:error instanceof assert.AssertionError?error.message:"Credit application verifier failed; inspect the named stage without logging credentials."})}\n`);process.exitCode=1;}
finally{await Promise.all([ownerPool.end(),runtimePool.end()]);}
