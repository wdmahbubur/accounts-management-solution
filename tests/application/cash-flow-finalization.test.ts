import assert from 'node:assert/strict';
import test from 'node:test';
import {finalizeCashFlowCommand} from '../../apps/web/server/reports/cash-flow-finalization.ts';
test('cash-flow review requires real dates, an exact digest and no client-supplied authority',()=>{
 const command=finalizeCashFlowCommand({rpc:async()=>{throw new Error('No RPC should be called during validation');}});
 const valid={from:'2025-01-01',to:'2025-01-31',expected_digest:'a'.repeat(64)};
 assert.deepEqual(command.validate(valid),valid);
 for(const invalid of[{...valid,from:'2025-02-30'},{...valid,to:'2024-01-01'},{...valid,expected_digest:'ready'},{...valid,finalized:true},{...valid,actor_id:'owner'}])assert.throws(()=>command.validate(invalid));
});
