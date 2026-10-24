import 'server-only';
import type {OrganizationId,Uuid} from '@ams/contracts';

/** Resolved from an approved server-side catalog, never a browser price. */
export type ApprovedBillingPlan = Readonly<{id:Uuid;version:string;providerPriceId:string}>;
export type CheckoutContext = Readonly<{organizationId:OrganizationId;memberId:Uuid;plan:ApprovedBillingPlan;idempotencyKey:string;successUrl:string;cancelUrl:string}>;
/** Tenant binding must use stored provider identifiers, not webhook metadata. */
export type VerifiedBillingEvent = Readonly<{provider:string;eventId:string;eventType:string;customerId:string;subscriptionId:string;occurredAt:string;revision:string}>;
export interface BillingAdapter {
  readonly provider:string;
  readonly enabled:boolean;
  createCheckout(input:CheckoutContext):Promise<{id:string;url:string}>;
  createPortal(input:Readonly<{customerId:string;returnUrl:string}>):Promise<{url:string}>;
  verifyWebhook(input:Readonly<{rawBody:Uint8Array;headers:Pick<Headers,'get'>}>):Promise<VerifiedBillingEvent>;
}
export class BillingDisabledError extends Error {
  readonly code='BILLING_DISABLED';
  constructor(){super('Paid billing is not enabled.');this.name='BillingDisabledError';}
}
const disabled=async():Promise<never>=>{throw new BillingDisabledError();};
export const disabledBillingAdapter:BillingAdapter=Object.freeze({provider:'disabled',enabled:false,createCheckout:disabled,createPortal:disabled,verifyWebhook:disabled});

export function getBillingAdapter(env:{BILLING_PROVIDER?:string}={BILLING_PROVIDER:process.env.BILLING_PROVIDER}):BillingAdapter{
  const provider=env.BILLING_PROVIDER?.trim()||'disabled';
  if(provider!=='disabled')throw new Error('Unsupported billing provider configuration.');
  return disabledBillingAdapter;
}
