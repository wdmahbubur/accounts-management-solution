import {parseOrganizationId} from '@ams/contracts';
import {redirect} from 'next/navigation';
import {roleRuntime} from '../../../../../server/roles/runtime.ts';
import {resolveActorContext} from '../../../../../server/auth/resolve-actor.ts';
import {CommandError} from '../../../../../server/commands/errors.ts';
import {getBillingAdapter} from '../../../../../server/billing/adapter.ts';
import {readSubscriptionSummary,type SubscriptionSummary} from '../../../../../server/billing/subscription.ts';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function SubscriptionPage({params}:{params:Promise<{organizationId:string}>}){
 const org=parseOrganizationId((await params).organizationId),runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==org)redirect('/companies?error=context_mismatch');
 let summary:SubscriptionSummary;
 try{const actor=await resolveActorContext(org,runtime.dependencies);if(!actor.capabilities.includes('subscription.read'))throw CommandError.forbidden();
  summary=await readSubscriptionSummary(runtime.client,org);
 }catch(error){if(error instanceof CommandError&&error.code==='UNAUTHENTICATED')redirect('/auth/sign-in?next=/companies');if(error instanceof CommandError&&['FORBIDDEN','NOT_FOUND'].includes(error.code))return <main className="content"><h1>Access denied</h1><p>You need subscription.read to view this company subscription.</p></main>;throw error;}
 const adapter=getBillingAdapter(),subscription=summary.subscription;
 return <main className="content"><p className="eyebrow">Company settings</p><h1>Subscription</h1><section className="panel"><h2>Paid billing</h2><p role="status">{adapter.enabled?'Provider configured; paid plan approval is required.':'Paid billing is not enabled.'}</p><p>Paid plans, prices and limits will appear after approval.</p></section><section className="panel"><h2>Company account</h2><dl><dt>Active members</dt><dd>{summary.activeMembers}</dd><dt>Paid plan</dt><dd>{subscription?.planName??'Not configured'}</dd>{subscription&&<><dt>Subscription state</dt><dd>{subscription.status.replaceAll('_',' ')}</dd><dt>Current period</dt><dd>{subscription.periodStart??'Not set'} to {subscription.periodEnd??'Not set'}</dd>{subscription.graceUntil&&<><dt>Configured grace end</dt><dd>{subscription.graceUntil}</dd></>}</>}</dl></section></main>;
}
