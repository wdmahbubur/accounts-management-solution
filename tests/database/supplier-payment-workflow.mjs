// Explicit isolated-only run; each run creates new synthetic organizations.
// Owner SQL seeds identities/roles/catalog fixtures only. Business save/setup/approval/post/read
// operations use a separate actual ams_app_login. Never resets or changes prior fixture companies.
// AMS_DATABASE_TESTS=isolated node tests/database/supplier-payment-workflow.mjs
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
const ids={owner:randomUUID(),writer:randomUUID(),reader:randomUUID(),noDues:randomUUID(),sales:randomUUID(),outsider:randomUUID()};
const run=randomUUID(),today=bangladeshDate(),past=shift(today,-2),future=shift(today,10),later=shift(today,11);
let org,foreignOrg,vendor,otherVendor,foreignVendor,customer,cash,accounts,checks=0,stage="connect";
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
  'sources',(SELECT jsonb_agg(jsonb_build_array(id,state,version,material_digest,document_number) ORDER BY id) FROM finance.business_documents WHERE organization_id=$1),
  'sequences',(SELECT jsonb_agg(jsonb_build_array(document_type,next_value) ORDER BY document_type) FROM finance.document_sequences WHERE organization_id=$1),
  'journals',(SELECT count(*) FROM finance.journal_entries WHERE organization_id=$1),'lines',(SELECT count(*) FROM finance.journal_lines WHERE organization_id=$1),
  'items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),
  'unapplies',(SELECT count(*) FROM finance.allocation_reversals WHERE organization_id=$1),'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),
  'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),'requests',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1)) AS data`,[org])).rows[0].data;}
async function options(party=vendor,date=today,user=ids.writer,organization=org){
  const before=await evidence();const result=await actor(user,c=>c.query("SELECT * FROM public.read_supplier_payment_allocation_options($1,$2,$3::date)",[organization,party,date]),true);
  assert.deepEqual(await evidence(),before);return result.rows;
}
async function lifecycle(document,user=ids.reader,organization=org){
  const before=await evidence();const result=await actor(user,c=>c.query("SELECT public.read_supplier_document_lifecycle($1,$2) AS data",[organization,document.document_id]),true);
  assert.deepEqual(await evidence(),before);return result.rows[0].data;
}
function payload(type,amount,extra={}){
  const bill=type==="bill";
  return {document_type:type,party_id:vendor,issue_date:past,accounting_date:past,due_date:bill?past:null,description:`Synthetic supplier workflow ${type}`,external_reference:null,currency:"BDT",
    rounding_adjustment:"0.00",rounding_reason:null,rounding_account_id:null,
    trade:bill?{recognition_mode:"earned_or_incurred",performance_confirmed:true,supplier_invoice_date:past,supplier_invoice_key:`SUP-${randomUUID()}`}:null,
    movement:bill?null:{cash_account_id:cash,direction:"out",amount,method:"bank_transfer",reference:"Synthetic payment only",cash_flow_class:"operating"},transfer:null,
    lines:bill?[{id:null,item_id:null,original_line_id:null,description:"Supplier service",quantity:"1.000000",unit_price:`${amount}0000`,discount_amount:"0.00",account_id:accounts["6000"],cost_center_id:null,tax_code_id:null,tax_mode:"exclusive",cash_flow_class:null}]:[],
    journal_rows:[],allocation_plan:[],...extra};
}
async function save(body,user=ids.owner,current=null){const key=randomUUID();return(await actor(user,c=>c.query(
  "SELECT * FROM public.save_financial_document($1,$2,$3,$4,$5,$6,$7::jsonb)",[org,current?.document_id??null,current?.document_version??null,`supplier_${key}`,key,hash(body),JSON.stringify(body)]))).rows[0];}
async function submit(document){const key=randomUUID();const result=(await actor(ids.owner,c=>c.query(
  "SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)",[org,document.document_id,document.document_version,`documents.submit:${document.document_id}`,`supplier_${key}`,key,hash(document)]))).rows[0];assert.equal(result.state,"approved");return result;}
async function post(document,key=randomUUID()){return(await actor(ids.owner,c=>c.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)",
  [org,document.document_id,document.document_version,`supplier_${key}`,key,hash(document)]))).rows[0];}
async function posted(body){const document=await save(body);await submit(document);await post(document);return document;}
async function openItem(document){const rows=(await ownerQuery(`SELECT oi.id FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id
  JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id WHERE j.organization_id=$1 AND j.source_document_id=$2`,[org,document.document_id])).rows;assert.equal(rows.length,1);return rows[0].id;}
async function preview(document){const before=await evidence();const result=await actor(ids.owner,c=>c.query("SELECT public.preview_cash_document_posting($1,$2,$3) AS data",[org,document.document_id,document.document_version]),true);assert.deepEqual(await evidence(),before);return result.rows[0].data;}
async function reverse(document,date=today){const key=randomUUID();return(await actor(ids.owner,c=>c.query("SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)",
  [org,document.document_id,date,"Synthetic supplier workflow correction",`supplier_${key}`,key,hash([document,date])]))).rows[0];}
async function journal(document){return(await ownerQuery(`SELECT l.line_no,a.code,l.debit::text,l.credit::text FROM finance.journal_lines l
  JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id
  WHERE j.organization_id=$1 AND j.source_document_id=$2 ORDER BY l.line_no`,[org,document.document_id])).rows;}

try {
  const role=(await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole,pg_has_role(current_user,'ams_runtime','member') AS runtime_member FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  assert.equal(role.current_user,"ams_app_login");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolcreaterole,false);assert.equal(role.runtime_member,true);
  stage="isolated fixture setup";
  for(const [name,id] of Object.entries(ids)){
    await ownerQuery("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())",[id,`supplier-${id}@example.invalid`,`Supplier QA ${name}`,"$argon2id$synthetic-unusable-test-hash"]);
    await ownerQuery("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')",[id,`Supplier QA ${name}`]);
  }
  org=(await actor(ids.owner,c=>c.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)",[`Supplier Workflow QA ${run}`,`${today.slice(0,4)}-01-01`,run]))).rows[0].organization_id;
  const setupKey=randomUUID();await actor(ids.owner,c=>c.query("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)",[org,`supplier_${setupKey}`,setupKey,hash("zero") ]));
  foreignOrg=(await actor(ids.owner,c=>c.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)",[`Foreign Supplier QA ${run}`,`${today.slice(0,4)}-01-01`,randomUUID()]))).rows[0].organization_id;
  for(const [user,name,permissions] of [[ids.writer,"Supplier preparer",["purchases.write","documents.read","dues.read"]],[ids.reader,"Supplier reader",["purchases.read"]],
    [ids.noDues,"Unallocated preparer",["purchases.write","documents.read"]],[ids.sales,"Sales only",["sales.read","sales.write","documents.read","dues.read"]]]){
    const member=randomUUID(),roleId=randomUUID();await ownerQuery("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)",[member,org,user,name]);
    await ownerQuery("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)",[roleId,org,name]);
    await ownerQuery("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])",[org,roleId,permissions]);
    await ownerQuery("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)",[org,member,roleId]);
  }
  accounts=Object.fromEntries((await ownerQuery("SELECT code,id FROM finance.accounts WHERE organization_id=$1",[org])).rows.map(row=>[row.code,row.id]));
  vendor=randomUUID();otherVendor=randomUUID();customer=randomUUID();foreignVendor=randomUUID();cash=randomUUID();
  for(const [id,organization,name,isVendor] of [[vendor,org,"Supplier one",true],[otherVendor,org,"Supplier two",true],[customer,org,"Customer only",false],[foreignVendor,foreignOrg,"Foreign supplier",true]]){
    await ownerQuery("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,$3,$4,$5)",[id,organization,name,!isVendor,isVendor]);
  }
  await ownerQuery("INSERT INTO finance.cash_accounts(id,organization_id,name,kind,account_id,is_cash_equivalent,allow_negative_balance) VALUES($1,$2,'Synthetic supplier bank','bank',$3,true,false)",[cash,org,accounts["1010"]]);
  const ownerRole=(await ownerQuery("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[org])).rows[0].id;
  for(const type of ["bill","vendor_payment"]){const key=randomUUID();await actor(ids.owner,c=>c.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'999999999.00',$7,1,false,true,$8)",
    [org,`supplier_${key}`,key,hash(type),`Supplier QA ${type}`,type,ownerRole,"Synthetic below-threshold test policy"]));}
  report("actual restricted login; unique fixtures; runtime company creation/zero activation; privileged identity/role/contact/bank seeding disclosed",{organization_id:org});

  stage="bill choices and permissions";
  const billA=await posted(payload("bill","1000.00")),billB=await posted(payload("bill","500.00"));
  const itemA=await openItem(billA),itemB=await openItem(billB);
  const listed=await options();assert.equal(listed.length,2);assert.ok(listed.every(row=>row.organization_id===org&&row.party_id===vendor&&row.supplier_reference.startsWith("SUP-")));
  assert.equal(listed.find(row=>row.document_id===billA.document_id).available_amount,"1000.00");
  for(const user of [ids.reader,ids.noDues,ids.sales,ids.outsider])await expectSql("42501",()=>options(vendor,today,user));
  for(const party of [customer,foreignVendor,randomUUID()])await expectSql("22023",()=>options(party));
  await expectSql("42501",()=>options(vendor,today,ids.writer,foreignOrg));
  await expectSql("P0002",()=>lifecycle(billA,ids.owner,foreignOrg));await expectSql("42501",()=>lifecycle(billA,ids.sales));
  const unallocated=await save(payload("vendor_payment","0.01"),ids.noDues);assert.ok(unallocated.document_id);
  await expectSql("42501",()=>save(payload("vendor_payment","1.00",{allocation_plan:[{target_open_item_id:itemA,amount:"1.00"}]}),ids.noDues));
  report("read-only target choices expose exact supplier references/capacity; role, customer-only, foreign-party and foreign-company denials; unallocated preparation still works without dues.read");

  stage="multiple bill settlement";
  const payment=await save(payload("vendor_payment","900.00",{allocation_plan:[{target_open_item_id:itemA,amount:"600.00"},{target_open_item_id:itemB,amount:"200.00"}]}),ids.writer);
  assert.equal((await options()).find(row=>row.document_id===billA.document_id).available_amount,"1000.00","drafts must not reserve capacity");
  const plan=await preview(payment);assert.equal(plan.allocated_amount,"800.00");assert.equal(plan.unallocated_amount,"100.00");assert.equal(plan.debit,"900.00");assert.equal(plan.credit,"900.00");
  await submit(payment);const postKey=randomUUID(),receipt=await post(payment,postKey),after=await evidence();assert.deepEqual(await post(payment,postKey),receipt);assert.deepEqual(await evidence(),after);
  const paymentLines=await journal(payment);assert.equal(paymentLines.length,2);
  assert.deepEqual(paymentLines.map(({code,debit,credit})=>({code,debit,credit})).sort((a,b)=>a.code.localeCompare(b.code)),[{code:"1010",debit:"0.00",credit:"900.00"},{code:"2000",debit:"900.00",credit:"0.00"}]);
  const payLife=await lifecycle(payment),billLife=await lifecycle(billA);
  assert.equal(payLife.residual_amount,"100.00");assert.equal(payLife.applied_amount,"800.00");assert.equal(payLife.settlement_status,"partially_allocated");assert.equal(payLife.allocations.length,2);
  assert.equal(billLife.residual_amount,"400.00");assert.equal(billLife.applied_amount,"600.00");assert.equal(billLife.settlement_status,"partially_paid");assert.equal(billLife.overdue,true);
  report("partial payment across two bills matches authoritative preview, posts AP debit/bank credit without a second expense, leaves unused trade debit and replays once");

  stage="wrong-party and material edit checks";
  const wrongBill=await posted(payload("bill","25.00",{party_id:otherVendor})),wrongItem=await openItem(wrongBill);
  const beforeWrong=await evidence();await expectSql("23514",()=>save(payload("vendor_payment","1.00",{allocation_plan:[{target_open_item_id:wrongItem,amount:"1.00"}]})));assert.deepEqual(await evidence(),beforeWrong);
  const mutable=await save(payload("vendor_payment","20.00",{allocation_plan:[{target_open_item_id:itemA,amount:"20.00"}]}));await submit(mutable);
  const edited=await save(payload("vendor_payment","21.00",{allocation_plan:[{target_open_item_id:itemA,amount:"20.00"}]}),ids.owner,mutable);assert.equal(edited.document_version,mutable.document_version+1);assert.equal(edited.state,"draft");
  await expectSql("40001",()=>post(mutable));
  report("wrong-supplier target fails atomically and editing an approved payment invalidates its source version/review");

  stage="historical capacity and future settlement";
  const historical=await posted(payload("bill","1000.00")),historicalItem=await openItem(historical);
  const futurePay=await posted(payload("vendor_payment","800.00",{issue_date:future,accounting_date:future,allocation_plan:[{target_open_item_id:historicalItem,amount:"800.00"}]}));
  const choice=(await options()).find(row=>row.document_id===historical.document_id);assert.equal(choice.residual_amount,"1000.00");assert.equal(choice.available_amount,"200.00");
  const futureLife=await lifecycle(futurePay);assert.equal(futureLife.settlement_status,"not_yet_effective");assert.equal(futureLife.residual_amount,null);assert.equal(futureLife.applied_amount,"0.00");
  const histLife=await lifecycle(historical);assert.equal(histLife.residual_amount,"1000.00");assert.equal(histLife.allocations[0].effective_date,future);
  const stale=await save(payload("vendor_payment","201.00",{allocation_plan:[{target_open_item_id:historicalItem,amount:"201.00"}]}));
  const beforePreview=await evidence();await expectSql("23P01",()=>preview(stale));assert.deepEqual(await evidence(),beforePreview);
  const allocationId=futureLife.allocations[0].id,key=randomUUID();await actor(ids.owner,c=>c.query("SELECT * FROM public.reverse_open_item_allocation($1,$2,$3,$4,$5,$6,$7::date,$8)",
    [org,allocationId,`allocations.reverse:${allocationId}`,`supplier_${key}`,key,hash(allocationId),later,"Synthetic future allocation unapply"]));
  assert.equal((await options()).find(row=>row.document_id===historical.document_id).available_amount,"200.00");
  assert.equal((await options(vendor,later)).find(row=>row.document_id===historical.document_id).available_amount,"1000.00");
  assert.equal((await lifecycle(historical)).allocations[0].reversed_on,later);
  report("backdated choices respect every future capacity boundary; future allocation/unapply history is retained while current lifecycle totals use company today");

  stage="void future and reversed source exclusions";
  const draft=await save(payload("bill","12.00")),voidBill=await save(payload("bill","13.00"));
  // Explicit privileged fault/state fixture: no financial facts are written for this void source.
  await ownerQuery("UPDATE finance.business_documents SET state='void',version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2",[org,voidBill.document_id]);
  const futureBill=await posted(payload("bill","14.00",{issue_date:future,accounting_date:future,due_date:future}));
  const reversed=await posted(payload("bill","15.00")),originalLines=await journal(reversed);await reverse(reversed);
  const futureReversed=await posted(payload("bill","16.00"));await reverse(futureReversed,future);
  const excluded=new Set([draft.document_id,voidBill.document_id,futureBill.document_id,reversed.document_id,futureReversed.document_id]);
  assert.ok((await options()).every(row=>!excluded.has(row.document_id)));
  const reversedLife=await lifecycle(reversed);assert.equal(reversedLife.settlement_status,"reversed");assert.equal(reversedLife.residual_amount,"0.00");assert.equal(reversedLife.corrections.length,0,"purchase-only readers cannot read generic reversal details");assert.equal(reversedLife.allocations[0].counter_document_id,null);
  assert.equal((await lifecycle(reversed,ids.owner)).corrections.length,1);assert.deepEqual(await journal(reversed),originalLines);
  assert.equal((await lifecycle(futureReversed)).settlement_status,"unpaid","future reversal must not masquerade as already effective");
  assert.equal((await lifecycle(futureBill)).settlement_status,"not_yet_effective");assert.equal((await lifecycle(voidBill)).settlement_status,"not_posted");
  report("draft/void/future/reversed sources excluded; effective reversal state and future history remain dated; generic reversal metadata stays permission-scoped; original journal is unchanged");

  stage="competing supplier payments";
  const raceBill=await posted(payload("bill","10.00")),raceItem=await openItem(raceBill);
  const racers=await Promise.all([save(payload("vendor_payment","6.00",{allocation_plan:[{target_open_item_id:raceItem,amount:"6.00"}]})),save(payload("vendor_payment","6.00",{allocation_plan:[{target_open_item_id:raceItem,amount:"6.00"}]}))]);
  for(const racer of racers)await submit(racer);
  const attempts=await Promise.allSettled(racers.map(document=>post(document)));
  assert.equal(attempts.filter(result=>result.status==="fulfilled").length,1);const rejected=attempts.find(result=>result.status==="rejected");assert.equal(rejected.reason.code,"23P01");
  assert.equal((await lifecycle(raceBill)).residual_amount,"4.00");
  const postedCount=(await ownerQuery("SELECT count(*)::integer AS count FROM finance.journal_entries WHERE organization_id=$1 AND source_document_id=ANY($2::uuid[])",[org,racers.map(document=>document.document_id)])).rows[0].count;assert.equal(postedCount,1);
  report("two independent runtime connections competing for 10.00 residual commit only one 6.00 supplier payment and leave 4.00 outstanding");
  process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:org,bill_id:billA.document_id,payment_id:payment.document_id,note:"Unique synthetic fixtures retained. Privileged identity/role/contact/bank seeding and one void-state fixture are explicit; business commands and reads used the actual restricted login. No reset, prior fixture changes or provider calls."})}\n`);
}catch(error){process.stderr.write(`${JSON.stringify({result:"failed",checks,stage,organization_id:org,code:typeof error?.code==="string"?error.code:undefined,message:error instanceof assert.AssertionError?error.message:"Supplier database verifier failed; inspect the named stage without logging credentials."})}\n`);process.exitCode=1;}
finally{await Promise.all([ownerPool.end(),runtimePool.end()]);}
