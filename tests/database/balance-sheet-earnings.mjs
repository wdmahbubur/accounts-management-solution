// Isolated-only regression: fresh synthetic companies, no reset or existing-company mutation.
// Identity/contact/role seeds use the owner; setup and financial commands use actual ams_app_login.
// AMS_DATABASE_TESTS=isolated node tests/database/balance-sheet-earnings.mjs
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
const runtimePool=new Pool({connectionString:runtimeUrl,max:1,connectionTimeoutMillis:30000});
const owner=randomUUID(),reader=randomUUID(),outsider=randomUUID(),run=randomUUID(),today=bangladeshDate();
const past=shift(today,-2),future=shift(today,10),later=shift(today,11);
let org,foreignOrg,party,accounts,checks=0,stage="connect";
const hash=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report=(check,details={})=>{checks++;process.stdout.write(`${JSON.stringify({check,status:"passed",...details})}\n`);};
const ownerQuery=(sql,args=[])=>ownerPool.query(sql,args);
function shift(date,days){const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
function units(value){assert.match(value,/^-?(0|[1-9]\d*)(\.\d{1,2})?$/);const negative=value.startsWith("-"),[whole,fraction=""]=value.replace(/^-/,"").split(".");return(BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0")))*(negative?-1n:1n);}
function money(actual,expected){assert.equal(units(actual),units(expected));}
async function actor(user,work,readOnly=false){
  const client=await runtimePool.connect();
  try{await client.query(readOnly?"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN");await client.query("SET LOCAL statement_timeout='30s'");await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[user]);const result=await work(client);await client.query(readOnly?"ROLLBACK":"COMMIT");return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
async function evidence(){return(await ownerQuery(`SELECT jsonb_build_object(
  'sources',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM finance.business_documents d WHERE organization_id=$1),
  'journals',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM finance.journal_entries j WHERE organization_id=$1),
  'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE organization_id=$1),
  'sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM finance.document_sequences s WHERE organization_id=$1),
  'items',(SELECT count(*) FROM finance.open_items WHERE organization_id=$1),'allocations',(SELECT count(*) FROM finance.settlement_allocations WHERE organization_id=$1),
  'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1),
  'requests',(SELECT count(*) FROM finance.idempotency_requests WHERE organization_id=$1),'snapshots',(SELECT count(*) FROM finance.report_snapshots WHERE organization_id=$1)) AS data`,[org])).rows[0].data;}
function payload(type,amount,date){return {document_type:type,party_id:party,issue_date:date,accounting_date:date,due_date:date,description:`Synthetic earnings regression ${type}`,external_reference:null,currency:"BDT",
  rounding_adjustment:"0.00",rounding_reason:null,rounding_account_id:null,
  trade:{recognition_mode:"earned_or_incurred",performance_confirmed:true,supplier_invoice_date:type==="bill"?date:null,supplier_invoice_key:type==="bill"?`BS-${randomUUID()}`:null},
  movement:null,transfer:null,lines:[{id:null,item_id:null,original_line_id:null,description:"Synthetic service",quantity:"1.000000",unit_price:`${amount}0000`,discount_amount:"0.00",account_id:accounts[type==="bill"?"5000":"4000"],cost_center_id:null,tax_code_id:null,tax_mode:"exclusive",cash_flow_class:null}],journal_rows:[],allocation_plan:[]};}
async function posted(body){
  const key=randomUUID(),submitKey=randomUUID(),postKey=randomUUID();
  const document=(await actor(owner,c=>c.query("SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)",[org,`balance_${key}`,key,hash(body),JSON.stringify(body)]))).rows[0];
  const review=(await actor(owner,c=>c.query("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)",[org,document.document_id,document.document_version,`documents.submit:${document.document_id}`,`balance_${submitKey}`,submitKey,hash(document)]))).rows[0];assert.equal(review.state,"approved");
  await actor(owner,c=>c.query("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)",[org,document.document_id,document.document_version,`balance_${postKey}`,postKey,hash(document)]));return document;
}
async function balance(asOf,comparison=null,user=owner,organization=org){return(await actor(user,c=>c.query("SELECT public.read_balance_sheet_snapshot($1,$2::date,$3::date) AS data",[organization,asOf,comparison]),true)).rows[0].data;}
function statement(row,{assets,liabilities,earnings}){money(row.assets,assets);money(row.liabilities,liabilities);money(row.equity_accounts,"0.00");money(row.untransferred_earnings,earnings);money(row.equity,earnings);money(row.liabilities_and_equity,assets);money(row.difference,"0.00");}

try {
  const role=(await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole,pg_has_role(current_user,'ams_runtime','member') AS runtime_member FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
  assert.equal(role.current_user,"ams_app_login");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolcreaterole,false);assert.equal(role.runtime_member,true);
  stage="isolated fixture setup";
  for(const user of [owner,reader]){await ownerQuery("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,'Balance Sheet QA',$3,now())",[user,`balance-${user}@example.invalid`,"$argon2id$synthetic-unusable-test-hash"]);
    await ownerQuery("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,'Balance Sheet QA','en-BD','Asia/Dhaka')",[user]);}
  for(const foreign of [false,true]){const organization=(await actor(owner,c=>c.query("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)",
    [`${foreign?"Foreign ":""}Balance Sheet QA ${run}`,`${today.slice(0,4)}-01-01`,randomUUID()]))).rows[0].organization_id;
    const key=randomUUID();await actor(owner,c=>c.query("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)",[organization,`balance_${key}`,key,hash("zero")]));if(foreign)foreignOrg=organization;else org=organization;}
  const member=randomUUID(),roleId=randomUUID();await ownerQuery("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,'Purchase-only reader')",[member,org,reader]);
  await ownerQuery("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,'Purchase-only reader')",[roleId,org]);
  await ownerQuery("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code='purchases.read'",[org,roleId]);
  await ownerQuery("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)",[org,member,roleId]);
  party=randomUUID();await ownerQuery("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Synthetic service counterparty',true,true)",[party,org]);
  accounts=Object.fromEntries((await ownerQuery("SELECT code,id FROM finance.accounts WHERE organization_id=$1",[org])).rows.map(row=>[row.code,row.id]));
  const ownerRole=(await ownerQuery("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[org])).rows[0].id;
  for(const type of ["invoice","bill"]){const key=randomUUID();await actor(owner,c=>c.query("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'2000.00',$7,1,false,true,$8)",
    [org,`balance_${key}`,key,hash(type),`Balance QA ${type}`,type,ownerRole,"Synthetic below-threshold test policy"]));}
  report("actual restricted login and runtime company setup; privileged identity/contact/role fixture setup explicitly separate",{organization_id:org});

  stage="income expense liability regression";
  const invoice=await posted(payload("invoice","1625.63",past)),bill=await posted(payload("bill","500.00",today)),before=await evidence();
  const current=await balance(today,past);statement(current.data.current,{assets:"1625.63",liabilities:"500.00",earnings:"1125.63"});statement(current.data.comparison,{assets:"1625.63",liabilities:"0.00",earnings:"1625.63"});
  money(current.data.current.accounts.find(row=>row.account_code==="5000").amount,"-500.00");money(current.data.current.accounts.find(row=>row.account_code==="4000").amount,"1625.63");
  const pl=(await actor(owner,c=>c.query("SELECT public.read_profit_loss_snapshot($1,$2::date,$3::date,NULL,NULL,NULL) AS data",[org,`${today.slice(0,4)}-01-01`,today]),true)).rows[0].data;money(pl.data.totals.net_profit,"1125.63");
  const trial=(await actor(owner,c=>c.query("SELECT * FROM public.read_trial_balance($1,$2::date,NULL)",[org,today]),true)).rows;
  assert.equal(trial.reduce((sum,row)=>sum+units(row.closing_debit)-units(row.closing_credit),0n),0n);
  const dashboard=(await actor(owner,c=>c.query("SELECT public.read_finance_dashboard($1,$2::date,$3::date,$3::date) AS data",[org,`${today.slice(0,4)}-01-01`,today]),true)).rows[0].data;
  assert.ok(!dashboard.data.exceptions.some(row=>row.code==="balance_sheet_difference"));money(dashboard.data.balance_sheet.difference,"0.00");assert.deepEqual(await evidence(),before);
  report("1625.63 income minus 500.00 expense yields 1125.63 equity, balanced trial balance and zero dashboard/report difference; expense row is negative");

  stage="as-of comparison future and expense reversal";
  await posted(payload("bill","100.00",future));
  statement((await balance(today)).data.current,{assets:"1625.63",liabilities:"500.00",earnings:"1125.63"});statement((await balance(future)).data.current,{assets:"1625.63",liabilities:"600.00",earnings:"1025.63"});
  const reversalKey=randomUUID();await actor(owner,c=>c.query("SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)",[org,bill.document_id,later,"Synthetic expense sign regression reversal",`balance_${reversalKey}`,reversalKey,hash(bill)]));
  const dated=await balance(later,today);statement(dated.data.current,{assets:"1625.63",liabilities:"100.00",earnings:"1525.63"});statement(dated.data.comparison,{assets:"1625.63",liabilities:"500.00",earnings:"1125.63"});
  money(dated.data.current.accounts.find(row=>row.account_code==="5000").amount,"-100.00");
  report("current/comparison statements retain cutoff behavior across future expense and later linked reversal; expense reduction increases earnings only when effective");

  stage="read boundary and tenant isolation";
  const beforeReads=await evidence();for(const user of [reader,outsider])await assert.rejects(()=>balance(today,null,user),error=>error?.code==="42501");
  const empty=(await balance(today,null,owner,foreignOrg)).data.current;statement(empty,{assets:"0.00",liabilities:"0.00",earnings:"0.00"});assert.equal(empty.accounts.length,0);
  await assert.rejects(()=>balance(today,null,reader,foreignOrg),error=>error?.code==="42501");assert.deepEqual(await evidence(),beforeReads);
  report("reports.read and company boundaries remain enforced; read-only statements create no financial, audit, idempotency or saved-report effects");
  process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:org,invoice_id:invoice.document_id,bill_id:bill.document_id,note:"New synthetic fixtures retained. Setup identities/contact/role seed is privileged; financial commands and reads use restricted runtime. Opening-import and year-close/reopen workflows are unchanged by the patch but not exercised here."})}\n`);
}catch(error){process.stderr.write(`${JSON.stringify({result:"failed",checks,stage,organization_id:org,code:typeof error?.code==="string"?error.code:undefined,message:error instanceof assert.AssertionError?error.message:"Balance-sheet verifier failed; inspect the named stage without logging credentials."})}\n`);process.exitCode=1;}
finally{await Promise.all([ownerPool.end(),runtimePool.end()]);}
