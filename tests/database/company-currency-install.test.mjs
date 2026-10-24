import assert from 'node:assert/strict';
import test from 'node:test';
import {Pool} from '@neondatabase/serverless';
import {createAccountingFixture,money} from './helpers/accounting-fixture.mjs';
import {assertIsolatedTargets} from './helpers/isolation.mjs';
test('fresh canonical installation creates usable USD books under the restricted runtime',{timeout:180_000},async()=>{
 const owner=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL,runtime=process.env.TEST_DATABASE_RUNTIME_URL??process.env.DATABASE_RUNTIME_URL;
 assertIsolatedTargets(owner,runtime);assert.match(new URL(owner).pathname,/^\/ams_currency_test_\d{8}(?:_[a-z0-9]+)?$/,'Choose a separately created empty currency installation database.');
 const db=new Pool({connectionString:owner,max:1});
 try{assert.equal((await db.query('SELECT count(*)::int AS n FROM finance.organizations')).rows[0].n,0,'Fresh-install verification requires an empty migrated database.');assert.equal((await db.query('SELECT count(*)::int AS n FROM app_meta.schema_migrations')).rows[0].n,122);}finally{await db.end();}
 const f=await createAccountingFixture({currency:'USD',country:'US'});
 try{
  assert.equal((await f.admin.query('SELECT count(*)::int AS n FROM finance.tax_codes WHERE organization_id=$1',[f.org])).rows[0].n,0,'Country selection must not invent a statutory tax rate.');
  const doc=await f.posted(f.body('invoice','123.45'));assert.ok(doc.document_id);
  const snapshot=(await f.rpc("SELECT public.read_profit_loss_snapshot($1,'2025-01-01','2025-12-31',NULL,NULL,NULL) AS value",[f.org])).rows[0].value;
  assert.equal(snapshot.company.base_currency,'USD');money(snapshot.data.totals.net_profit,'123.45');
  await assert.rejects(f.save(f.body('invoice','1.00',{currency:'BDT'})),e=>e.code==='23514');
 }finally{await f.close();}
});
