import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readJournalRegister } from "../../../../../server/documents/journal-register.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";

export const dynamic="force-dynamic"; export const revalidate=0;
export default async function JournalRegisterPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{account?:string;source?:string;period?:string}>}) {
  let organizationId; try { organizationId=parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const filters=await searchParams, account=(filters.account??"").slice(0,100), source=(filters.source??"").slice(0,100), period=(filters.period??"").slice(0,100);
  const runtime=await roleRuntime(); if(!runtime.current||runtime.current.organizationId!==organizationId) redirect("/companies?error=context_mismatch");
  try { const actor=await resolveActorContext(organizationId,runtime.dependencies); const rows=await readJournalRegister(runtime.client,actor,{account,source,period});
    return <main className="content"><p className="eyebrow">Accounting</p><h1>Journal register</h1><p>Posted ledger entries with their immutable source documents and dated reversal links.</p>
      {actor.capabilities.includes("journal.write")&&<p><Link className="primary" href={`/o/${organizationId}/accounting/journals/new`}>Create manual journal</Link></p>}
      <form className="panel toolbar" action={`/o/${organizationId}/accounting/journals`} method="get"><label>Account code or name<input name="account" maxLength={100} defaultValue={account}/></label><label>Source number, type or memo<input name="source" maxLength={100} defaultValue={source}/></label><label>Period label<input name="period" maxLength={100} defaultValue={period}/></label><button type="submit">Filter</button></form>
      <section className="panel"><h2>Posted journal history</h2>{rows.length===0?<p>No posted journals match these filters.</p>:<div className="table-scroll"><table><thead><tr><th>Date</th><th>Journal / source</th><th>Type</th><th>Memo / accounts</th><th>Period</th><th>Debit (BDT)</th><th>Credit (BDT)</th><th>Creator</th><th>Status</th></tr></thead><tbody>{rows.map(row=><tr key={row.journalEntryId}><td>{row.accountingDate}</td><td><Link href={`/o/${organizationId}/accounting/journals/${row.journalEntryId}`}>{row.documentNumber}</Link><small>{row.journalEntryId}</small></td><td>{row.sourceType.replaceAll("_"," ")}</td><td>{row.memo||"—"}<small>{row.accounts}</small></td><td>{row.periodLabel}</td><td>{row.debitTotal}</td><td>{row.creditTotal}</td><td>{row.creator}</td><td>{row.reversalJournalEntryId?<>Reversed {row.reversalDate}<br/><Link href={`/o/${organizationId}/accounting/journals/${row.reversalJournalEntryId}`}>View reversal</Link></>:row.reversesJournalEntryId?<><Link href={`/o/${organizationId}/accounting/journals/${row.reversesJournalEntryId}`}>Reversal</Link></>:"Posted"}</td></tr>)}</tbody></table></div>}</section>
    </main>;
  } catch(error) { if(error instanceof CommandError&&error.code==="UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies"); if(error instanceof CommandError&&error.code==="FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need ledger.read to view the journal register.</p></main>; throw error; }
}
