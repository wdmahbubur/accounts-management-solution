import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions, readFinancialDocument } from "../../../../../../server/documents/service.ts";
import { canPostDocument } from "../../../../../../server/documents/posting.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";
import { PostingAction } from "../posting-action.tsx";
import { WriteOffSubmitAction } from "../write-off-submit-action.tsx";
import styles from "../documents.module.css";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function DocumentDetailPage({params}:{params:Promise<{organizationId:string;documentId:string}>}){
 let organizationId;let documentId;try{const p=await params;organizationId=parseOrganizationId(p.organizationId);documentId=parseUuid(p.documentId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const document=await readFinancialDocument(runtime.client,actor,documentId);
  const type=String(document.document_type);const canEdit=String(document.state)==="draft"&&(sourceTypes as readonly string[]).includes(type);
  let editor=null;if(canEdit){const raw=await readDraftOptions(runtime.client,actor,type,String(document.accounting_date));const options={accounts:Array.isArray(raw.accounts)?raw.accounts as DraftOptions["accounts"]:[],parties:Array.isArray(raw.parties)?raw.parties as DraftOptions["parties"]:[],cash_accounts:Array.isArray(raw.cash_accounts)?raw.cash_accounts as DraftOptions["cash_accounts"]:[],rounding_accounts:Array.isArray(raw.rounding_accounts)?raw.rounding_accounts as DraftOptions["rounding_accounts"]:[],tax_codes:Array.isArray(raw.tax_codes)?raw.tax_codes as DraftOptions["tax_codes"]:[]};
    editor=<DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={type as SourceType} options={options} initial={document} expectedVersion={Number(document.version)}/>;}
  return <main className={styles.main}><p><Link href={`/o/${organizationId}/accounting/documents`}>← Financial documents</Link></p>{editor??<><section className={`panel ${styles.panel}`}><p className="eyebrow">{document.document_type}</p><h1>{document.document_number??"Draft"}</h1><p>State: {String(document.state)} · Accounting date: {String(document.accounting_date)}</p><p>Total (BDT): {String(document.total_amount)}</p><p>{String(document.description??"")}</p>{String(type)==="write_off"&&<div><h2>Controlled write-off evidence</h2>{document.write_off&&typeof document.write_off==="object"&&<p>Target receivable item: {String((document.write_off as Record<string,unknown>).target_open_item_id)} · Reason: {String((document.write_off as Record<string,unknown>).reason)}</p>}{Array.isArray(document.journal_rows)&&<table><thead><tr><th>Account</th><th>Party</th><th>Reference</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{(document.journal_rows as Record<string,unknown>[]).map((row,i)=><tr key={i}><td>{String(row.account_id)}</td><td>{String(row.party_id??"—")}</td><td>{String(row.open_item_reference??"—")}</td><td>{String(row.debit)}</td><td>{String(row.credit)}</td></tr>)}</tbody></table>}{document.posted_journal&&typeof document.posted_journal==="object"&&<><h3>Posted ledger entry {String((document.posted_journal as Record<string,unknown>).id)}</h3><table><thead><tr><th>Account</th><th>Party</th><th>Open item</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{(Array.isArray((document.posted_journal as Record<string,unknown>).lines)?(document.posted_journal as Record<string,unknown>).lines as Record<string,unknown>[]:[]).map((line,i)=><tr key={i}><td>{String(line.account_id)}</td><td>{String(line.party_id??"—")}</td><td>{String(line.open_item_id??"—")}</td><td>{String(line.debit)}</td><td>{String(line.credit)}</td></tr>)}</tbody></table></>}<p>Tax is not automatically reversed for this bad-debt write-off. The linked debit and credit open items document the explicit settlement.</p></div>}</section>
    {String(type)==="write_off"&&String(document.state)==="draft"&&<WriteOffSubmitAction organizationId={organizationId} documentId={documentId} version={Number(document.version)}/>}
    {String(document.state)==="approved"&&canPostDocument(actor,String(document.document_type))&&<PostingAction organizationId={organizationId} documentId={documentId} version={Number(document.version)}/>}
   </>}</main>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main><h1>Access denied</h1><p>You do not have permission to open this document.</p></main>;throw error;}
}
