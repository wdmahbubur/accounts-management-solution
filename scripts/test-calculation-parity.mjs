import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { calculateDocument } from '@ams/accounting';
import { goldenCases, invalidCases, parityCases } from '../tests/fixtures/calculation-cases.ts';
const url=process.env.SUPABASE_LOCAL_DB_URL??'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))throw Error('Calculation parity requires an isolated loopback DB.');
function query(input){
  // JSON is data in a SQL string; quotes are escaped, never executable interpolation.
  const json=JSON.stringify(input).replaceAll("'","''");
  return spawnSync('psql',[url,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',`set role authenticated; select public.calculate_document_preview('${json}'::jsonb);`],{encoding:'utf8',timeout:10000});
}
for(const input of [...goldenCases.map(c=>c.input),...parityCases]){
 const result=query(input);assert.equal(result.status,0,result.stderr);
 assert.deepEqual(JSON.parse(result.stdout.trim()),calculateDocument(input));
}
for(const input of invalidCases){const result=query(input);assert.notEqual(result.status,0,'Database accepted invalid input');assert.throws(()=>calculateDocument(input));}
console.log(`US-013 parity PASS: ${goldenCases.length+parityCases.length} exact TypeScript/PostgreSQL previews and ${invalidCases.length} invalid boundaries, ordinary authenticated role.`);
