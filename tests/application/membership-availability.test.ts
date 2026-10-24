import assert from 'node:assert/strict';
import test from 'node:test';
import {createMembershipResolver} from '../../apps/web/server/auth/membership-resolver.ts';
import {listActiveMemberships} from '../../apps/web/server/companies/memberships.ts';
import {parseOrganizationId,parseUuid} from '@ams/contracts';
const context={organizationId:parseOrganizationId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),userId:parseUuid('11111111-1111-4111-8111-111111111111')};
test('a database outage stays unavailable rather than pretending membership was removed',async()=>{
 const client={rpc:async()=>({data:null,error:{code:'08006',message:'Synthetic connection failure'}})};
 await assert.rejects(()=>createMembershipResolver(client).resolveActiveMembership(context),/could not be checked/);
 await assert.rejects(()=>listActiveMemberships(client),/could not be loaded/);
});
test('a genuinely inaccessible company is still masked and an empty directory remains valid',async()=>{
 for(const response of[{data:[],error:null},{data:null,error:{code:'42501'}},{data:null,error:{code:'P0002'}}])assert.equal(await createMembershipResolver({rpc:async()=>response}).resolveActiveMembership(context),null);
 assert.deepEqual(await listActiveMemberships({rpc:async()=>({data:[],error:null})}),[]);
});
