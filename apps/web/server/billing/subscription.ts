import {CommandError} from '../commands/errors.ts';
import {record} from '../documents/contracts.ts';
import type {RequestClient} from '../request-client.ts';
import type {OrganizationId} from '@ams/contracts';
export type SubscriptionSummary={organizationId:OrganizationId;activeMembers:number;subscription:null|{planName:string;planCode:string;status:string;periodStart:string|null;periodEnd:string|null;graceUntil:string|null}};
export async function readSubscriptionSummary(client:Pick<RequestClient,'rpc'>,organizationId:OrganizationId):Promise<SubscriptionSummary>{
 const result=await client.rpc('read_subscription_summary',{p_organization_id:organizationId});
 if(result.error){if(result.error.code==='42501')throw CommandError.forbidden();if(result.error.code==='P0002')throw CommandError.notFound();throw new Error('Subscription information could not be loaded.');}
 const data=record(result.data);
 if(data.organization_id!==organizationId||!Number.isSafeInteger(data.active_members)||(data.active_members as number)<0)throw new Error('Invalid subscription summary.');
 let subscription:SubscriptionSummary['subscription']=null;
 if(data.subscription!==null){const s=record(data.subscription);if(typeof s.plan_name!=='string'||typeof s.plan_code!=='string'||!['trialing','active','past_due','canceled','read_only'].includes(String(s.status))||['period_start','period_end','grace_until'].some(k=>s[k]!==null&&(typeof s[k]!=='string'||!Number.isFinite(Date.parse(s[k] as string)))))throw new Error('Invalid subscription state.');
  subscription={planName:s.plan_name,planCode:s.plan_code,status:String(s.status),periodStart:s.period_start as string|null,periodEnd:s.period_end as string|null,graceUntil:s.grace_until as string|null};}
 return {organizationId,activeMembers:data.active_members as number,subscription};
}
