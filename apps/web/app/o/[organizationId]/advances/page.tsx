import Link from 'next/link';
import { redirect } from 'next/navigation';
import { parseOrganizationId,parseUuid } from '@ams/contracts';
import { resolveActorContext } from '../../../../server/auth/resolve-actor.ts';
import { roleRuntime } from '../../../../server/roles/runtime.ts';
import { readSettlementOptions } from '../../../../server/documents/linked-settlements.ts';
import { readDraftOptions,readFinancialDocument } from '../../../../server/documents/service.ts';
import { bangladeshDate } from '../../../../lib/date.ts';
import { CommandError } from '../../../../server/commands/errors.ts';
import { SettlementForm } from './settlement-form.tsx';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function AdvancesPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{date?:string;tab?:string;document_id?:string;mode?:string}>}){
  const organizationId=parseOrganizationId((await params).organizationId),q=await searchParams,runtime=await roleRuntime();
  if(!runtime.current||runtime.current.organizationId!==organizationId)redirect('/companies?error=context_mismatch');
  const date=q.date??bangladeshDate(),tab=q.tab==='vendor'?'vendor':'customer';
  let loaded:{actor:Awaited<ReturnType<typeof resolveActorContext>>;options:Awaited<ReturnType<typeof readSettlementOptions>>;canWrite:boolean;draftOptions:Record<string,unknown>;initial:Record<string,unknown>|undefined}|undefined;
  let failure:unknown;
  try{
    const actor=await resolveActorContext(organizationId,runtime.dependencies),options=await readSettlementOptions(runtime.client,actor,date);
    const canWrite=actor.capabilities.includes('dues.allocate')&&actor.capabilities.includes('banking.write')&&actor.capabilities.includes('journal.write');
    const draftOptions=canWrite?await readDraftOptions(runtime.client,actor,actor.capabilities.includes('sales.write')?'customer_refund':'vendor_refund',date):{};
    const initial=q.document_id?await readFinancialDocument(runtime.client,actor,parseUuid(q.document_id)):undefined;
    if(initial&&(!initial.linked_settlement||['posted','void'].includes(String(initial.state))))throw CommandError.notFound();
    loaded={actor,options,canWrite,draftOptions,initial};
  }catch(e){failure=e;}
  if(failure||!loaded){if(failure&&!(failure instanceof CommandError))throw failure;return <main className="content"><h1>Advances and refunds</h1><p role="alert">{failure instanceof CommandError&&failure.code==='FORBIDDEN'?'You do not have access to these balances.':'Balances could not be loaded. Check the date and refresh.'}</p><Link href={`/o/${organizationId}/accounting/documents`}>Financial documents</Link></main>;}
  const {actor,options,canWrite,draftOptions,initial}=loaded;
  const advances=options.sources.filter(s=>s.control_kind===`${tab}_advance`);
    return <main className="content"><p className="eyebrow">Finance</p><h1>Advances and refunds</h1>
      <nav className="actions" aria-label="Advance type"><Link href={`?tab=customer&date=${date}`} aria-current={tab==='customer'?'page':undefined}>Customer advances</Link><Link href={`?tab=vendor&date=${date}`} aria-current={tab==='vendor'?'page':undefined}>Supplier advances</Link></nav>
      <form method="get" className="panel toolbar"><input type="hidden" name="tab" value={tab}/><label>As of<input name="date" type="date" required defaultValue={date}/></label><button>Refresh balances</button></form>
      <div className="actions">{actor.capabilities.includes(tab==='customer'?'sales.write':'purchases.write')&&<Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=${tab}_advance`}>Record advance</Link>}<Link href={`/o/${organizationId}/accounting/documents`}>Financial documents</Link></div>
      <section className="panel"><h2>{tab==='customer'?'Customer':'Supplier'} advances · BDT</h2>{!advances.length?<p>No advances recorded for this date.</p>:<div className="table-scroll" tabIndex={0} role="region" aria-label="Advance balances"><table><thead><tr><th>Advance</th><th>Party</th><th>Original</th><th>Applied</th><th>Refunded</th><th>Remaining</th><th>History</th></tr></thead><tbody>{advances.map(a=><tr key={a.id}><th><Link href={`/o/${organizationId}/accounting/documents/${a.document_id}`}>{a.document_type==='opening_balance'?a.reference:a.document_number}</Link>{a.reversed&&' · Reversed'}</th><td>{a.party_name}</td><td>{a.original_amount}</td><td>{a.applied_amount}</td><td>{a.refunded_amount}</td><td>{a.remaining_amount}</td><td><details><summary>Activity</summary>{a.history?.length?a.history.map((h,i)=><p key={i}><Link href={`/o/${organizationId}/accounting/documents/${h.document_id}`}>{h.document_number}</Link> · {h.effective_date} · {h.amount}{h.reversed_on?` · Unapplied ${h.reversed_on}`:''}</p>):<p>No settlements.</p>}</details></td></tr>)}</tbody></table></div>}</section>
      {canWrite&&<SettlementForm key={`${tab}:${date}:${initial?.id??'new'}:${initial?.version??0}`} organizationId={organizationId} nonce={runtime.current.nonce} options={options} cashAccounts={Array.isArray(draftOptions.cash_accounts)?draftOptions.cash_accounts as {id:string;name:string}[]:[]} initial={initial} mode={q.mode} initialSide={tab}/>}
    </main>;
}
