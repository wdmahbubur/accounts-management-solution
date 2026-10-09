// Fresh isolated fixtures only. No retained browser company changes or database reset.
// AMS_DATABASE_TESTS=isolated node --conditions=react-server tests/database/banking-reconciliation-workflow.mjs
// Pre-fix diagnosis only: add AMS_EXPECT_RECONCILIATION_BASELINE=1; unsafe finalize is rolled back.
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {neonConfig,Pool,types} from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";
import {bangladeshDate} from "../../apps/web/lib/date.ts";
import {readStatementMatrix,mapStatementRows} from "../../apps/web/server/banking/statement-import.ts";

assert.equal(process.env.AMS_DATABASE_TESTS,"isolated","Explicitly select an isolated test database.");
const ownerUrl=process.env.TEST_DATABASE_URL??process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL;
const runtimeUrl=process.env.TEST_DATABASE_RUNTIME_URL??process.env.DATABASE_RUNTIME_URL;
let sameTarget=false;
try{const a=new URL(ownerUrl),b=new URL(runtimeUrl);sameTarget=a.hostname===b.hostname&&a.pathname===b.pathname&&decodeURIComponent(b.username)==="ams_app_login";}catch{/* Never echo configuration. */}
assert.ok(sameTarget,"Select the isolated owner and actual runtime on the same database.");
neonConfig.webSocketConstructor=WebSocket;types.setTypeParser(types.builtins.DATE,value=>value);
const adminPool=new Pool({connectionString:ownerUrl,max:1,connectionTimeoutMillis:30000});
const runtimePool=new Pool({connectionString:runtimeUrl,max:2,connectionTimeoutMillis:30000});
const ids={owner:randomUUID(),reader:randomUUID(),writer:randomUUID(),noAuth:randomUUID(),outsider:randomUUID()};
const today=bangladeshDate(),run=randomUUID(),baseline=process.env.AMS_EXPECT_RECONCILIATION_BASELINE==="1";
let org,foreignOrg,cash,otherCash,party,accounts,checks=0,stage="connect";
const hash=value=>createHash("sha256").update(typeof value==="string"?value:JSON.stringify(value)).digest("hex");
const report=(check,extra={})=>{checks++;process.stdout.write(`${JSON.stringify({check,status:"passed",...extra})}\n`);};
const admin=(sql,args=[])=>adminPool.query(sql,args);
async function actor(user,work,{readOnly=false,rollback=false}={}){
  const client=await runtimePool.connect();
  try{await client.query(readOnly?"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY":"BEGIN");await client.query("SET LOCAL statement_timeout='30s'");await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[user]);const result=await work(client);await client.query(readOnly||rollback?"ROLLBACK":"COMMIT");return result;
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
}
const rpc=(sql,args,user=ids.owner,options={})=>actor(user,c=>c.query(sql,args),options);
async function expectSql(code,work){await assert.rejects(work,error=>error?.code===code);}
async function facts(){return(await admin(`SELECT jsonb_build_object(
  'documents',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM finance.business_documents d WHERE organization_id=$1),
  'journals',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM finance.journal_entries j WHERE organization_id=$1),
  'lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM finance.journal_lines l WHERE organization_id=$1),
  'movements',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM finance.money_movements m WHERE organization_id=$1),
  'sequences',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM finance.document_sequences s WHERE organization_id=$1),
  'items',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM finance.open_items o WHERE organization_id=$1),
  'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM finance.settlement_allocations a WHERE organization_id=$1)) AS value`,[org])).rows[0].value;}
async function stateCounts(){return(await admin(`SELECT jsonb_build_object(
  'imports',(SELECT count(*) FROM finance.bank_imports WHERE organization_id=$1),'statement_lines',(SELECT count(*) FROM finance.statement_lines WHERE organization_id=$1),
  'reconciliations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM finance.reconciliations r WHERE organization_id=$1),
  'matches',(SELECT count(*) FROM finance.reconciliation_matches WHERE organization_id=$1),'unmatches',(SELECT count(*) FROM finance.reconciliation_match_reversals WHERE organization_id=$1),
  'reopens',(SELECT count(*) FROM finance.reconciliation_reopen_events WHERE organization_id=$1),'audit',(SELECT count(*) FROM finance.audit_events WHERE organization_id=$1),
  'outbox',(SELECT count(*) FROM finance.outbox_events WHERE organization_id=$1)) AS value`,[org])).rows[0].value;}
async function workspace(id,user=ids.owner,organization=org){return(await rpc("SELECT public.read_reconciliation_workspace($1,$2) AS value",[organization,id],user,{readOnly:true})).rows[0].value;}
async function history(user=ids.reader,organization=org,status=null){return(await rpc("SELECT public.read_reconciliation_list($1,NULL,$2,0) AS value",[organization,status],user,{readOnly:true})).rows[0].value;}
async function parsed(csv){const source=await readStatementMatrix(new File([csv],"synthetic-bank.csv",{type:"text/csv"}));const mapped=mapStatementRows(source.matrix,{date:0,description:1,debit:2,credit:3,reference:4});assert.deepEqual(mapped.errors,[]);return{...source,rows:mapped.rows};}
async function importSource(source,account=cash,user=ids.owner){return(await rpc("SELECT public.import_bank_statement_rows($1,$2,$3,$4,$5::jsonb,$6::bytea) AS value",[org,account,source.sha256,"synthetic-bank.csv",JSON.stringify(source.rows),source.bytes],user)).rows[0].value;}
async function session(account=cash,opening="0.00",closing="90.00",user=ids.owner){return(await rpc("SELECT public.create_reconciliation($1,$2,$3::date,$3::date,$4,$5,$6) AS id",[org,account,today,opening,closing,`bank_${randomUUID()}`],user)).rows[0].id;}
async function match(reconciliation,statement,book,amount,user=ids.owner){return(await rpc("SELECT public.add_reconciliation_match($1,$2,$3,$4,$5,$6) AS id",[org,reconciliation,statement,book,amount,`bank_${randomUUID()}`],user)).rows[0].id;}
async function unmatch(reconciliation,id,user=ids.owner){return(await rpc("SELECT public.reverse_reconciliation_match($1,$2,$3,$4,$5) AS id",[org,reconciliation,id,"Synthetic correction of partial match",`bank_${randomUUID()}`],user)).rows[0].id;}
async function finalize(reconciliation,user=ids.owner,rollback=false){return(await rpc("SELECT public.finalize_reconciliation($1,$2,$3) AS value",[org,reconciliation,`bank_${randomUUID()}`],user,{rollback})).rows[0].value;}
async function reopen(reconciliation,user=ids.owner){return(await rpc("SELECT public.reopen_reconciliation($1,$2,$3,$4) AS id",[org,reconciliation,"Synthetic authorized reconciliation reopen",`bank_${randomUUID()}`],user)).rows[0].id;}
function payload(type,extra={}){return{document_type:type,party_id:type==="transfer"?null:party,issue_date:today,accounting_date:today,due_date:type==="invoice"?today:null,description:`Synthetic banking ${type}`,external_reference:null,currency:"BDT",
  rounding_adjustment:"0.00",rounding_reason:null,rounding_account_id:null,trade:type==="invoice"?{recognition_mode:"earned_or_incurred",performance_confirmed:true}:null,
  movement:type==="receipt"?{cash_account_id:cash,direction:"in",amount:"100.00",method:"bank_transfer",reference:"Synthetic receipt",cash_flow_class:"operating"}:null,
  transfer:type==="transfer"?{from_cash_account_id:cash,to_cash_account_id:otherCash,amount:"10.00",fee_amount:"0.00",fee_account_id:null}:null,
  lines:type==="invoice"?[{id:null,item_id:null,original_line_id:null,description:"Synthetic service",quantity:"1.000000",unit_price:"100.000000",discount_amount:"0.00",account_id:accounts["4000"],cost_center_id:null,tax_code_id:null,tax_mode:"exclusive",cash_flow_class:null}]:[],journal_rows:[],allocation_plan:[],...extra};}
async function posted(body){const key=randomUUID(),reviewKey=randomUUID(),postKey=randomUUID();
  const document=(await rpc("SELECT * FROM public.save_financial_document($1,NULL,NULL,$2,$3,$4,$5::jsonb)",[org,`bank_${key}`,key,hash(body),JSON.stringify(body)])).rows[0];
  const reviewed=(await rpc("SELECT * FROM public.submit_financial_document($1,$2,$3,$4,$5,$6,$7)",[org,document.document_id,document.document_version,`documents.submit:${document.document_id}`,`bank_${reviewKey}`,reviewKey,hash(document)])).rows[0];assert.equal(reviewed.state,"approved");
  await rpc("SELECT * FROM public.post_financial_document($1,$2,$3,$4,$5,$6)",[org,document.document_id,document.document_version,`bank_${postKey}`,postKey,hash(document)]);return document;}
async function reverseDocument(document){const key=randomUUID();return rpc("SELECT * FROM public.reverse_posted_document($1,$2,$3::date,$4,$5,$6,$7)",[org,document.document_id,today,"Synthetic reconciled cash reversal probe",`bank_${key}`,key,hash(document)]);}

try {
  const role=(await runtimePool.query("SELECT current_user,r.rolsuper,r.rolbypassrls,r.rolcreaterole FROM pg_roles r WHERE r.rolname=current_user")).rows[0];assert.equal(role.current_user,"ams_app_login");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);assert.equal(role.rolcreaterole,false);
  stage="fixture setup";
  for(const [name,user] of Object.entries(ids)){await admin("INSERT INTO identity.users(id,email_normalized,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now())",[user,`banking-${user}@example.invalid`,`Banking QA ${name}`,"$argon2id$synthetic-unusable-test-hash"]);await admin("INSERT INTO finance.profiles(user_id,display_name,locale,timezone) VALUES($1,$2,'en-BD','Asia/Dhaka')",[user,`Banking QA ${name}`]);}
  for(const foreign of [false,true]){const organization=(await rpc("SELECT * FROM public.create_company_atomic($1,$1,'BD','BDT','Asia/Dhaka',1::smallint,$2::date,$3)",[`Banking ${foreign?"foreign ":""}QA ${run}`,`${today.slice(0,4)}-01-01`,randomUUID()])).rows[0].organization_id;
    const key=randomUUID();await rpc("SELECT public.complete_company_setup($1,$2,$3,$4,'zero_opening',true,NULL,NULL)",[organization,`bank_${key}`,key,hash("zero")]);if(foreign)foreignOrg=organization;else org=organization;}
  for(const [user,name,permissions] of [[ids.reader,"Bank reader",["banking.read"]],[ids.writer,"Bank writer",["banking.write"]],[ids.noAuth,"Period operator without session",["banking.read","periods.lock","periods.reopen"]]]){
    const member=randomUUID(),roleId=randomUUID();await admin("INSERT INTO finance.organization_members(id,organization_id,user_id,display_name_snapshot) VALUES($1,$2,$3,$4)",[member,org,user,name]);await admin("INSERT INTO finance.roles(id,organization_id,name) VALUES($1,$2,$3)",[roleId,org,name]);
    await admin("INSERT INTO finance.role_permissions(organization_id,role_id,permission_id) SELECT $1,$2,id FROM finance.permissions WHERE code=ANY($3::text[])",[org,roleId,permissions]);await admin("INSERT INTO finance.member_roles(organization_id,member_id,role_id) VALUES($1,$2,$3)",[org,member,roleId]);}
  accounts=Object.fromEntries((await admin("SELECT code,id FROM finance.accounts WHERE organization_id=$1",[org])).rows.map(row=>[row.code,row.id]));party=randomUUID();await admin("INSERT INTO finance.contacts(id,organization_id,display_name,is_customer,is_vendor) VALUES($1,$2,'Banking QA customer',true,false)",[party,org]);
  cash=(await rpc("SELECT public.save_cash_account($1,'Banking QA bank','bank',$2,NULL,NULL,true,false) AS id",[org,accounts["1010"]])).rows[0].id;
  otherCash=(await rpc("SELECT public.save_cash_account($1,'Banking QA physical cash','cash',$2,NULL,NULL,true,false) AS id",[org,accounts["1000"]])).rows[0].id;
  const ownerRole=(await admin("SELECT id FROM finance.roles WHERE organization_id=$1 AND template_key='owner'",[org])).rows[0].id;
  for(const type of ["invoice","receipt","transfer"]){const key=randomUUID();await rpc("SELECT * FROM public.save_approval_policy($1,$2,$3,$4,NULL,0,$5,$6,'2000.00',$7,1,false,true,$8)",[org,`bank_${key}`,key,hash(type),`Banking QA ${type}`,type,ownerRole,"Synthetic below-threshold test policy"]);}
  const invoice=await posted(payload("invoice"));
  const invoiceItem=(await admin("SELECT oi.id FROM finance.open_items oi JOIN finance.journal_lines l ON l.organization_id=oi.organization_id AND l.id=oi.journal_line_id JOIN finance.journal_entries j ON j.organization_id=l.organization_id AND j.id=l.journal_entry_id WHERE j.organization_id=$1 AND j.source_document_id=$2",[org,invoice.document_id])).rows[0].id;
  const receipt=await posted(payload("receipt",{allocation_plan:[{target_open_item_id:invoiceItem,amount:"100.00"}]}));await posted(payload("transfer"));
  const cashFacts=await facts();report("actual restricted commands create fresh company, cash accounts, receipt100 and transfer10; privileged identity/contact/role setup disclosed",{organization_id:org});

  stage="source import";
  const csv=`Date,Description,Debit,Credit,Reference\n${today},Receipt part one,,60.00,BANK-${run}-1\n${today},Receipt part two,,40.00,BANK-${run}-2\n${today},Transfer out,10.00,,BANK-${run}-3\n`;
  const source=await parsed(csv),imported=await importSource(source,cash,ids.writer);assert.equal(imported.row_count,3);assert.equal(imported.duplicate,false);
  const countsAfterImport=await stateCounts();const duplicate=await importSource(source,cash,ids.writer);assert.equal(duplicate.id,imported.id);assert.equal(duplicate.duplicate,true);assert.deepEqual(await stateCounts(),countsAfterImport);
  const retained=(await admin("SELECT source_content FROM finance_private.bank_import_sources WHERE organization_id=$1 AND import_id=$2",[org,imported.id])).rows[0].source_content;assert.deepEqual(retained,source.bytes);assert.deepEqual(await facts(),cashFacts);
  const reconciliation=await session(),work=await workspace(reconciliation),bank=work.statement_lines,book=work.book_lines;
  const bankIn1=bank.find(row=>row.source_transaction_id===`BANK-${run}-1`||row.reference===`BANK-${run}-1`),bankIn2=bank.find(row=>row.reference===`BANK-${run}-2`),bankOut=bank.find(row=>row.reference===`BANK-${run}-3`);
  assert.ok(bankIn1&&bankIn2&&bankOut);const bookIn=book.find(row=>row.signed_amount==="100.00"),bookOut=book.find(row=>row.signed_amount==="-10.00");assert.ok(bookIn&&bookOut);
  report("blank opposite columns import exact directions and original bytes; exact-file retry is a no-op and cash facts remain unchanged");

  if(baseline){
    stage="baseline matching defect";const before=await stateCounts();await expectSql("22P02",()=>match(reconciliation,bankIn1.id,bookIn.id,"60.00"));assert.deepEqual(await stateCounts(),before);
    report("PRE-FIX actual add_reconciliation_match rejects valid rows with22P02 before effects");
    stage="baseline net-cancellation finalize defect";
    await admin("INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at) SELECT $1,id,session_version,now(),now()+interval '8 hours' FROM identity.users WHERE id=$2",[randomUUID(),ids.owner]);
    // The physical-cash account has an outstanding10.00 book deposit. Statement
    // opening/closing0.00 plus that valid adjustment equals the book balance;
    // two additional unmatched opposite observations must still prevent close.
    const offsetSource=await parsed(`Date,Description,Debit,Credit,Reference\n${today},Unrecorded receipt,,100.00,OFFSET-${run}-1\n${today},Unrecorded payment,100.00,,OFFSET-${run}-2\n`);
    await importSource(offsetSource,otherCash);const offsetSession=await session(otherCash,"0.00","0.00"),beforeFinalize=await stateCounts();
    const invalid=await finalize(offsetSession,ids.owner,true);assert.equal(invalid.state,"finalized");assert.equal(invalid.evidence.unmatched_statement_lines.length,2);assert.equal(invalid.evidence.unexplained_difference,"0.00");assert.deepEqual(await stateCounts(),beforeFinalize);assert.deepEqual(await facts(),cashFacts);
    report("PRE-FIX unmatched +100/-100 bank-only movements can finalize with zero difference; unsafe finalization rolled back");
    stage="baseline cross-session evidence mutation";
    // The pre-fix add command cannot create any valid match. These three exact
    // evidence links are an explicitly privileged fixture, never ledger DML.
    const seeded=(await admin(`INSERT INTO finance.reconciliation_matches(organization_id,reconciliation_id,statement_line_id,journal_line_id,amount,created_by_member_id)
      SELECT $1,$2,x.statement_id::uuid,x.book_id::uuid,x.amount::finance.amount,m.id
      FROM jsonb_to_recordset($3::jsonb) x(statement_id text,book_id text,amount text)
      JOIN finance.organization_members m ON m.organization_id=$1 AND m.user_id=$4 RETURNING id,statement_line_id`,[org,reconciliation,JSON.stringify([{statement_id:bankIn1.id,book_id:bookIn.id,amount:"60.00"},{statement_id:bankIn2.id,book_id:bookIn.id,amount:"40.00"},{statement_id:bankOut.id,book_id:bookOut.id,amount:"10.00"}]),ids.owner])).rows;
    const overlap=(await rpc("SELECT public.create_reconciliation($1,$2,$3::date-1,$3::date,'0.00','90.00',$4) AS id",[org,cash,today,`bank_${randomUUID()}`])).rows[0].id;
    const beforeCross=await stateCounts();await actor(ids.owner,async client=>{
      const frozen=(await client.query("SELECT public.finalize_reconciliation($1,$2,$3) AS value",[org,overlap,`bank_${randomUUID()}`])).rows[0].value;assert.equal(frozen.evidence.unmatched_statement_lines.length,0);
      await client.query("SELECT public.reverse_reconciliation_match($1,$2,$3,$4,$5)",[org,reconciliation,seeded.find(row=>row.statement_line_id===bankIn1.id).id,"Synthetic cross-session freeze probe",`bank_${randomUUID()}`]);
      const invalidated=(await client.query("SELECT public.read_reconciliation_workspace($1,$2) AS value",[org,overlap])).rows[0].value;assert.equal(invalidated.reconciliation.state,"finalized");assert.equal(invalidated.statement_lines.find(row=>row.id===bankIn1.id).remaining,"60.00");
    },{rollback:true});assert.deepEqual(await stateCounts(),beforeCross);assert.deepEqual(await facts(),cashFacts);
    report("PRE-FIX overlapping draft can unmatch finalized evidence; privileged match fixture disclosed, ordinary finalize/unmatch both rolled back");
    process.stdout.write(`${JSON.stringify({result:"baseline_defects_reproduced",checks,organization_id:org,reconciliation_id:reconciliation,note:"Actual restricted SQL defects reproduced; unsafe finalize rolled back. Fresh import/source fixtures retained, browser companies untouched."})}\n`);
  }else{
    stage="valid matching and capacity boundaries";
    const partial=await match(reconciliation,bankIn1.id,bookIn.id,"40.00",ids.writer);await expectSql("23505",()=>match(reconciliation,bankIn1.id,bookIn.id,"20.00",ids.writer));await unmatch(reconciliation,partial,ids.writer);
    await match(reconciliation,bankIn1.id,bookIn.id,"60.00",ids.writer);await match(reconciliation,bankIn2.id,bookIn.id,"40.00",ids.writer);await match(reconciliation,bankOut.id,bookOut.id,"10.00",ids.writer);
    await expectSql("23514",()=>match(reconciliation,bankIn1.id,bookOut.id,"1.00"));await expectSql("23514",()=>match(reconciliation,bankIn2.id,bookIn.id,"0.01"));
    const matched=await workspace(reconciliation,ids.reader);assert.ok(matched.statement_lines.every(row=>row.remaining==="0.00"));assert.ok(matched.book_lines.every(row=>row.remaining==="0.00"));assert.equal(typeof matched.reconciliation.statement_opening,"string");assert.equal(typeof matched.reconciliation.statement_closing,"string");assert.deepEqual(await facts(),cashFacts);
    report("partial/unmatch/many-to-one matching works; incompatible directions and excess fail; workspace amounts are strings and cash facts unchanged");

    stage="finalize and session authentication";
    await expectSql("42501",()=>finalize(reconciliation,ids.noAuth));
    // Explicit privileged authentication fixture, not a bypass: missing-session
    // denial above and below prove the unchanged recent-auth gate is exercised.
    await admin("INSERT INTO identity.auth_sessions(id,user_id,session_version,recent_auth_at,expires_at) SELECT $1,id,session_version,now(),now()+interval '8 hours' FROM identity.users WHERE id=$2",[randomUUID(),ids.owner]);
    const final=await finalize(reconciliation);assert.equal(final.state,"finalized");assert.equal(final.evidence.book_closing,"90.00");assert.equal(final.evidence.unexplained_difference,"0.00");assert.equal(final.evidence.unmatched_statement_lines.length,0);
    const finalizedRead=await history(ids.reader,org,"finalized");assert.equal(finalizedRead.sessions.find(row=>row.id===reconciliation).status,"finalized");
    await expectSql("55000",()=>match(reconciliation,bankIn1.id,bookIn.id,"1.00"));await expectSql("55000",()=>unmatch(reconciliation,matched.matches.find(row=>!row.reversed).id));await expectSql("55000",()=>reverseDocument(receipt));
    report("recent authentication is required; valid finalization records90.00 and locks matching/reversal without changing posted cash");

    stage="reopen and readable history";
    await expectSql("42501",()=>reopen(reconciliation,ids.noAuth));await expectSql("42501",()=>reopen(reconciliation,ids.reader));const reopened=await reopen(reconciliation);assert.ok(reopened);
    const event=(await admin("SELECT prior_evidence_snapshot FROM finance.reconciliation_reopen_events WHERE organization_id=$1 AND id=$2",[org,reopened])).rows[0];assert.deepEqual(event.prior_evidence_snapshot,final.evidence);
    const reopenedRead=await history(ids.reader,org,"reopened"),row=reopenedRead.sessions.find(item=>item.id===reconciliation);assert.equal(row.status,"reopened");assert.equal(row.reopen_count,1);
    await finalize(reconciliation);assert.equal((await history(ids.reader,org,"finalized")).sessions.find(item=>item.id===reconciliation).status,"finalized");assert.deepEqual(await facts(),cashFacts);
    report("authorized reopen retains prior evidence; list distinguishes reopened and re-finalized sessions under banking.read");

    stage="cross-session finalized evidence and real two-connection race";
    await reopen(reconciliation);
    const overlap=(await rpc("SELECT public.create_reconciliation($1,$2,$3::date-1,$3::date,'0.00','90.00',$4) AS id",[org,cash,today,`bank_${randomUUID()}`])).rows[0].id;
    const activeMatch=(await workspace(reconciliation)).matches.find(row=>row.statement_line_id===bankIn1.id&&!row.reversed).id;
    const crossFinal=await finalize(overlap),beforeFrozen=await stateCounts();
    await expectSql("55000",()=>unmatch(reconciliation,activeMatch));await expectSql("55000",()=>match(reconciliation,bankIn1.id,bookIn.id,"0.01"));assert.deepEqual(await stateCounts(),beforeFrozen);
    assert.deepEqual((await workspace(overlap)).reconciliation.evidence_snapshot,crossFinal.evidence);
    await reopen(overlap);await unmatch(reconciliation,activeMatch);const racingMatch=await match(reconciliation,bankIn1.id,bookIn.id,"60.00");
    let ready=0,release;const gate=new Promise(resolve=>{release=resolve;}),backends=[];
    const contested=(sql,args)=>actor(ids.owner,async client=>{backends.push((await client.query("SELECT pg_backend_pid() AS id")).rows[0].id);if(++ready===2)release();
      let timer;try{await Promise.race([gate,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Concurrent test connection did not reach its barrier.")),30000);})]);}finally{clearTimeout(timer);}return client.query(sql,args);});
    const race=await Promise.allSettled([
      contested("SELECT public.finalize_reconciliation($1,$2,$3) AS value",[org,overlap,`bank_${randomUUID()}`]),
      contested("SELECT public.reverse_reconciliation_match($1,$2,$3,$4,$5) AS id",[org,reconciliation,racingMatch,"Synthetic concurrent unmatch probe",`bank_${randomUUID()}`])
    ]);
    assert.equal(new Set(backends).size,2);assert.equal(race.filter(result=>result.status==="fulfilled").length,1);
    if(race[0].status==="fulfilled"){assert.equal(race[1].reason.code,"55000");assert.equal((await workspace(overlap)).statement_lines.find(row=>row.id===bankIn1.id).remaining,"0.00");}
    else{assert.equal(race[0].reason.code,"23514");assert.equal((await workspace(overlap)).reconciliation.state,"draft");await match(reconciliation,bankIn1.id,bookIn.id,"60.00");await finalize(overlap);}
    await reopen(overlap);await finalize(reconciliation);assert.deepEqual(await facts(),cashFacts);
    report("overlapping draft cannot alter finalized statement/book matches; reopen permits correction; two actual connections serialize finalize versus unmatch",{race_winner:race[0].status==="fulfilled"?"finalize":"unmatch"});

    stage="bank-only cancellation guard and outstanding book allowance";
    const emptySession=await session(otherCash,"0.00","0.00"),outstanding=await finalize(emptySession);assert.equal(outstanding.evidence.unmatched_book_adjustment,"10.00");assert.equal(outstanding.evidence.unexplained_difference,"0.00");await reopen(emptySession);
    const offsetSource=await parsed(`Date,Description,Debit,Credit,Reference\n${today},Unrecorded receipt,,100.00,OFFSET-${run}-1\n${today},Unrecorded payment,100.00,,OFFSET-${run}-2\n`);await importSource(offsetSource,otherCash);
    const beforeRejected=await stateCounts();await expectSql("23514",()=>finalize(emptySession));assert.deepEqual(await stateCounts(),beforeRejected);assert.equal((await workspace(emptySession)).reconciliation.state,"draft");assert.deepEqual(await facts(),cashFacts);
    report("valid outstanding book deposit still adjusts closing; offsetting unmatched bank-only observations cannot finalize and create no effects");

    stage="permission tenant and read-only boundaries";
    const beforeReads=await stateCounts();await expectSql("42501",()=>importSource(source,cash,ids.reader));await expectSql("42501",()=>session(cash,"0.00","90.00",ids.reader));await expectSql("42501",()=>history(ids.writer));await expectSql("42501",()=>history(ids.outsider));await expectSql("42501",()=>history(ids.reader,foreignOrg));await expectSql("P0002",()=>workspace(reconciliation,ids.owner,foreignOrg));
    const foreign=await history(ids.owner,foreignOrg);assert.equal(foreign.sessions.length,0);assert.equal(foreign.accounts.length,0);await workspace(reconciliation,ids.reader);await history();assert.deepEqual(await stateCounts(),beforeReads);assert.deepEqual(await facts(),cashFacts);
    report("reader/writer/operator permissions and cross-company reads remain scoped; import/match/reconcile create no cash or control ledger facts");
    stage="history pagination and account filters";
    await rpc("SELECT public.create_reconciliation($1,$2,$3::date-n,$3::date-n,'0.00','0.00',$4||n) FROM generate_series(2,52) n",[org,cash,today,`bank_${randomUUID()}_`]);
    const beforePages=await stateCounts(),page1=await history(),page2=(await rpc("SELECT public.read_reconciliation_list($1,NULL,NULL,50) AS value",[org],ids.reader,{readOnly:true})).rows[0].value;
    assert.equal(page1.sessions.length,50);assert.equal(page1.has_more,true);assert.equal(page2.has_more,false);assert.equal(page2.sessions.length,4);assert.equal(new Set([...page1.sessions,...page2.sessions].map(row=>row.id)).size,54);
    const accountPage=(await rpc("SELECT public.read_reconciliation_list($1,$2,'reopened',0) AS value",[org,otherCash],ids.reader,{readOnly:true})).rows[0].value;assert.equal(accountPage.sessions.length,1);assert.equal(accountPage.sessions[0].cash_account_id,otherCash);
    await expectSql("P0002",()=>rpc("SELECT public.read_reconciliation_list($1,$2,NULL,0)",[foreignOrg,cash],ids.owner,{readOnly:true}));await expectSql("22023",()=>rpc("SELECT public.read_reconciliation_list($1,NULL,NULL,1)",[org],ids.reader,{readOnly:true}));
    assert.deepEqual(await stateCounts(),beforePages);assert.deepEqual(await facts(),cashFacts);report("history uses stable50-row pages, account/status scope and exact strings; foreign account and invalid offset fail without effects");
    process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:org,reconciliation_id:reconciliation,import_id:imported.id,note:"Unique fixtures retained. Privileged identity/contact/role and fresh Auth.js-session fixtures disclosed; all financial and banking commands ran through actual restricted login. No provider calls or retained-browser-company changes."})}\n`);
  }
}catch(error){process.stderr.write(`${JSON.stringify({result:"failed",checks,stage,organization_id:org,code:typeof error?.code==="string"?error.code:undefined,message:error instanceof assert.AssertionError?error.message:"Banking verifier failed; inspect the named stage without logging credentials."})}\n`);process.exitCode=1;}
finally{await Promise.all([adminPool.end(),runtimePool.end()]);}
