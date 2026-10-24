// Read-only regression after normal installation of migration 0098.
// Uses the existing synthetic bank's posted receipt 100.01 and transfer -20.01.
// Required: AMS_DATABASE_TESTS=isolated, DATABASE_RUNTIME_URL (or TEST_DATABASE_RUNTIME_URL),
// AMS_LEDGER_ORGANIZATION_ID, AMS_LEDGER_ACCOUNT_ID, AMS_LEDGER_FROM, AMS_LEDGER_TO.
// Optional: AMS_LEDGER_FOREIGN_ORGANIZATION_ID for a real mixed-company-account denial.
// No migration, actor/role creation, financial command, or fixture mutation occurs here.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {neonConfig,Pool,types} from "@neondatabase/serverless";
import "../../scripts/load-local-env.mjs";

assert.equal(process.env.AMS_DATABASE_TESTS,"isolated","Explicitly select an isolated test database.");
const runtimeUrl=process.env.TEST_DATABASE_RUNTIME_URL??process.env.DATABASE_RUNTIME_URL;
let ordinaryRuntime=false;
try{ordinaryRuntime=decodeURIComponent(new URL(runtimeUrl).username)==="ams_app_login";}catch{/* Never echo configuration. */}
assert.ok(ordinaryRuntime,"Select the isolated actual ams_app_login connection.");
const organizationId=process.env.AMS_LEDGER_ORGANIZATION_ID,accountId=process.env.AMS_LEDGER_ACCOUNT_ID;
const from=process.env.AMS_LEDGER_FROM,to=process.env.AMS_LEDGER_TO;
const foreignOrganizationId=process.env.AMS_LEDGER_FOREIGN_ORGANIZATION_ID;
for(const id of [organizationId,accountId,...(foreignOrganizationId?[foreignOrganizationId]:[])])assert.match(id??"",/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
for(const date of [from,to])assert.match(date??"",/^\d{4}-\d{2}-\d{2}$/);
assert.ok(from<=to,"Select the existing two-movement bank date range.");
neonConfig.webSocketConstructor=WebSocket;
types.setTypeParser(types.builtins.DATE,value=>value);
const pool=new Pool({connectionString:runtimeUrl,max:1,connectionTimeoutMillis:30000});
let client,checks=0,stage="connect";
function passed(check){checks++;process.stdout.write(`${JSON.stringify({check,status:"passed"})}\n`);}
function units(value){
  assert.match(value,/^-?(0|[1-9]\d*)(\.\d{1,2})?$/);
  const negative=value.startsWith("-"),[whole,fraction=""]=value.replace(/^-/ ,"").split(".");
  return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0")))*(negative?-1n:1n);
}
async function denied(code,sql,args){
  await client.query("SAVEPOINT expected_denial");
  try{await assert.rejects(()=>client.query(sql,args),error=>error?.code===code);}
  finally{await client.query("ROLLBACK TO SAVEPOINT expected_denial");await client.query("RELEASE SAVEPOINT expected_denial");}
}
const ledgerSql="SELECT * FROM public.read_general_ledger($1,$2,$3::date,$4::date,$5,$6,$7::date,$8,$9,$10)";
function ledgerArgs({organization=organizationId,account=accountId,source=null,after=null,limit=501}={}){
  return [organization,account,from,to,source,null,after?.accounting_date??null,after?.journal_id??null,after?.line_no??null,limit];
}
const snapshotSql="SELECT public.read_report_snapshot($1,'general_ledger',$2::jsonb) AS value";
const snapshotArgs=[organizationId,JSON.stringify({account:accountId,from,to,limit:1})];

try{
  client=await pool.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query("SET LOCAL lock_timeout='10s'");
  const role=(await client.query(`SELECT current_user,session_user,r.rolsuper,r.rolbypassrls,r.rolcreatedb,r.rolcreaterole,
    pg_has_role(current_user,'ams_runtime','member') AS runtime_member,
    has_table_privilege(current_user,'finance.journal_lines','INSERT') AS direct_ledger_insert
    FROM pg_roles r WHERE r.rolname=current_user`)).rows[0];
  assert.equal(role.current_user,"ams_app_login");assert.equal(role.session_user,role.current_user);
  for(const flag of ["rolsuper","rolbypassrls","rolcreatedb","rolcreaterole","direct_ledger_insert"])assert.equal(role[flag],false);
  assert.equal(role.runtime_member,true);
  assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
  // This is the ordinary Auth.js identity lookup, projecting only its UUID.
  const identities=(await client.query("SELECT id::text FROM identity.users WHERE email_normalized=$1 AND email_verified_at IS NOT NULL AND disabled_at IS NULL",
    ["demo@ams-public-demo.example"])).rows;
  assert.equal(identities.length,1,"The existing verified synthetic demo actor is required.");
  const actorId=identities[0].id;
  await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[actorId]);
  const membership=(await client.query("SELECT * FROM public.resolve_active_membership($1)",[organizationId])).rows;
  assert.equal(membership.length,1);assert.equal(membership[0].organization_id,organizationId);
  assert.ok(membership[0].capabilities.includes("ledger.read"));
  assert.ok((await client.query("SELECT * FROM public.list_report_accounts($1)",[organizationId])).rows.some(row=>row.id===accountId));
  passed("existing synthetic ledger reader uses ordinary restricted login inside one repeatable-read read-only transaction");

  stage="exact running balances and snapshot";
  const rows=(await client.query(ledgerSql,ledgerArgs())).rows;
  assert.equal(rows.length,2,"Select the existing synthetic receipt/transfer range without other movements.");
  assert.deepEqual(rows.map(row=>[row.source_type,units(row.movement)]).sort((a,b)=>a[0].localeCompare(b[0])),[["receipt",10001n],["transfer",-2001n]]);
  const sourceRows=(await client.query(`SELECT jl.id AS line_id,je.id AS journal_id,d.id AS source_document_id,
    je.accounting_date,jl.line_no,jl.debit::text,jl.credit::text
    FROM finance.journal_lines jl
    JOIN finance.journal_entries je ON je.organization_id=jl.organization_id AND je.id=jl.journal_entry_id AND je.state='posted'
    JOIN finance.business_documents d ON d.organization_id=je.organization_id AND d.id=je.source_document_id AND d.state='posted'
    WHERE jl.organization_id=$1 AND jl.account_id=$2 AND je.accounting_date BETWEEN $3::date AND $4::date
    ORDER BY je.accounting_date,je.id,jl.line_no`,[organizationId,accountId,from,to])).rows;
  assert.equal(sourceRows.length,2);
  let running=0n;
  for(const [index,row] of rows.entries()){
    assert.equal(row.account_id,accountId);assert.equal(units(row.opening_balance),0n);
    for(const field of ["line_id","journal_id","source_document_id","accounting_date","line_no","debit","credit"])assert.equal(row[field],sourceRows[index][field]);
    assert.equal(units(row.movement),units(row.debit)-units(row.credit));
    running+=units(row.movement);assert.equal(units(row.running_balance),running);
  }
  assert.equal(running,8000n);
  const snapshot=(await client.query(snapshotSql,snapshotArgs)).rows[0].value;
  assert.equal(snapshot.company.id,organizationId);assert.equal(units(snapshot.data.opening_balance),0n);
  assert.equal(snapshot.data.limit,1);assert.deepEqual(snapshot.data.rows,rows,"Snapshot preserves its extra pagination lookahead row.");
  passed("two actual posted source rows yield exact signed movements and final 80.00; report snapshot matches scoped posted journal facts");

  stage="cursor and source filters";
  const first=(await client.query(ledgerSql,ledgerArgs({limit:1}))).rows;
  assert.deepEqual(first,[rows[0]]);
  const next=(await client.query(ledgerSql,ledgerArgs({after:first[0],limit:1}))).rows;
  assert.deepEqual(next,[rows[1]]);assert.equal(units(next[0].running_balance),8000n);
  assert.equal((await client.query(ledgerSql,ledgerArgs({after:next[0],limit:1}))).rowCount,0);
  const nextSnapshot=(await client.query(snapshotSql,[organizationId,JSON.stringify({account:accountId,from,to,limit:1,
    after_date:first[0].accounting_date,after_journal:first[0].journal_id,after_line:first[0].line_no})])).rows[0].value;
  assert.deepEqual(nextSnapshot.data.rows,[rows[1]]);
  const selected=(await client.query(ledgerSql,ledgerArgs({source:"receipt"}))).rows;
  assert.equal(selected.length,1);assert.equal(selected[0].source_type,"receipt");
  assert.equal(units(selected[0].opening_balance),0n);assert.equal(units(selected[0].running_balance),10001n);
  passed("one-row keyset pagination keeps the complete running balance without duplicates; source filtering and snapshot cursor agree");

  stage="authentication capability and tenant guards";
  await client.query("SELECT set_config('ams.actor_user_id','',true)");
  await denied("28000",ledgerSql,ledgerArgs());await denied("28000",snapshotSql,snapshotArgs);
  await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[randomUUID()]);
  await denied("42501",ledgerSql,ledgerArgs());await denied("42501",snapshotSql,snapshotArgs);
  await client.query("SELECT set_config('ams.actor_user_id',$1,true)",[actorId]);
  await denied("P0002",ledgerSql,ledgerArgs({account:randomUUID()}));
  if(foreignOrganizationId){
    assert.notEqual(foreignOrganizationId,organizationId);
    const foreignAccounts=(await client.query("SELECT * FROM public.list_report_accounts($1)",[foreignOrganizationId])).rows;
    assert.ok(foreignAccounts.length>0,"Selected foreign synthetic company must have an account visible to the existing demo actor.");
    await denied("P0002",ledgerSql,ledgerArgs({account:foreignAccounts[0].id}));
    await denied("P0002",ledgerSql,ledgerArgs({organization:foreignOrganizationId}));
  }
  assert.deepEqual((await client.query(ledgerSql,ledgerArgs())).rows,rows);
  assert.equal((await client.query("SHOW transaction_read_only")).rows[0].transaction_read_only,"on");
  passed("missing actor and nonmember denied; unavailable account rejected; successful report unchanged after negative probes");
  process.stdout.write(`${JSON.stringify({result:"passed",checks,organization_id:organizationId,read_only:true,
    mixed_company_account_checked:Boolean(foreignOrganizationId),active_member_without_ledger_read_checked:false,
    note:"No rows or roles created/changed. Existing owner, missing-actor and nonmember paths exercised; distinct active-role denial and concurrency not exercised."})}\n`);
}catch(error){
  process.stderr.write(`${JSON.stringify({result:"failed",checks,stage,code:typeof error?.code==="string"?error.code:undefined,
    message:error instanceof assert.AssertionError?error.message:"General-ledger verifier failed; inspect the named stage without logging credentials."})}\n`);
  process.exitCode=1;
}finally{if(client){await client.query("ROLLBACK").catch(()=>undefined);client.release();}await pool.end();}
