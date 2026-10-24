import assert from 'node:assert/strict';
import test from 'node:test';
import {parseOrganizationId,parseUuid} from '@ams/contracts';
import {BillingDisabledError,getBillingAdapter} from '../../apps/web/server/billing/adapter.ts';
import {readSubscriptionSummary} from '../../apps/web/server/billing/subscription.ts';
import {deferredCheckoutCommand} from '../../apps/web/server/billing/checkout.ts';
import {POST as webhook} from '../../apps/web/app/api/v1/webhooks/billing/[provider]/route.ts';
const org=parseOrganizationId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),id=parseUuid('11111111-1111-4111-8111-111111111111');
test('missing billing configuration is disabled and unsupported providers cannot silently activate',()=>{
 assert.equal(getBillingAdapter({}).enabled,false);assert.equal(getBillingAdapter({BILLING_PROVIDER:'disabled'}).provider,'disabled');assert.ok(Object.isFrozen(getBillingAdapter({})));
 assert.throws(()=>getBillingAdapter({BILLING_PROVIDER:'unapproved-provider'}),/Unsupported billing provider/);
});
test('the disabled adapter rejects checkout, portal and forged webhook data without a provider effect',async()=>{
 const adapter=getBillingAdapter({});
 await assert.rejects(()=>adapter.createCheckout({organizationId:org,memberId:id,plan:{id,version:'synthetic-only',providerPriceId:'synthetic-only'},idempotencyKey:'synthetic',successUrl:'https://example.invalid/success',cancelUrl:'https://example.invalid/cancel'}),BillingDisabledError);
 await assert.rejects(()=>adapter.createPortal({customerId:'synthetic',returnUrl:'https://example.invalid'}),BillingDisabledError);
 await assert.rejects(()=>adapter.verifyWebhook({rawBody:new TextEncoder().encode('{"status":"active"}'),headers:new Headers()}),BillingDisabledError);
 const response=await webhook();assert.equal(response.status,503);assert.equal((await response.json()).error.code,'BILLING_DISABLED');
});
test('subscription summary checks tenant identity, actual member usage and unknown commercial terms',async()=>{
 const client={rpc:async()=>({error:null,data:{organization_id:org,subscription:null,active_members:4}})};
 assert.deepEqual(await readSubscriptionSummary(client,org),{organizationId:org,subscription:null,activeMembers:4});
 for(const data of[{organization_id:id,subscription:null,active_members:4},{organization_id:org,subscription:null,active_members:-1},{organization_id:org,subscription:null,active_members:'4'},{organization_id:org,active_members:4,subscription:{plan_name:'Synthetic',plan_code:'test',status:'unapproved'}}])await assert.rejects(()=>readSubscriptionSummary({rpc:async()=>({error:null,data})},org));
});
test('checkout rejects client-supplied prices, plans or entitlement authority while billing is deferred',()=>{
 const command=deferredCheckoutCommand();assert.equal(command.capability,'subscription.manage');assert.deepEqual(command.validate({}),{});
 for(const body of[{price:'1.00'},{plan_id:id},{status:'active'},{seat_limit:999}])assert.throws(()=>command.validate(body));
});
