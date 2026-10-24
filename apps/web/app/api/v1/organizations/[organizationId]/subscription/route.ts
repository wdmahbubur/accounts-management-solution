import {parseOrganizationId} from '@ams/contracts';
import {resolveActorContext} from '../../../../../../server/auth/resolve-actor.ts';
import {CommandError,commandErrorBody,normalizeCommandError} from '../../../../../../server/commands/errors.ts';
import {generateRequestId} from '../../../../../../server/commands/request-context.ts';
import {roleRuntime} from '../../../../../../server/roles/runtime.ts';
import {getBillingAdapter} from '../../../../../../server/billing/adapter.ts';
import {readSubscriptionSummary} from '../../../../../../server/billing/subscription.ts';
export const dynamic='force-dynamic';
export async function GET(_request:Request,context:{params:Promise<{organizationId:string}>}){
 const requestId=generateRequestId(),headers={'Cache-Control':'private, no-store'};
 try{const org=parseOrganizationId((await context.params).organizationId),runtime=await roleRuntime(),actor=await resolveActorContext(org,runtime.dependencies);if(!actor.capabilities.includes('subscription.read'))throw CommandError.forbidden();
  const summary=await readSubscriptionSummary(runtime.client,org),adapter=getBillingAdapter(),s=summary.subscription;
  return Response.json({data:{organization_id:summary.organizationId,active_members:summary.activeMembers,subscription:s?{plan_code:s.planCode,plan_name:s.planName,status:s.status,period_start:s.periodStart,period_end:s.periodEnd,grace_until:s.graceUntil}:null,billing:{enabled:adapter.enabled,provider:adapter.provider}},meta:{request_id:requestId}},{headers});
 }catch(error){const safe=normalizeCommandError(error);return Response.json(commandErrorBody(safe,requestId),{status:safe.status,headers});}
}
