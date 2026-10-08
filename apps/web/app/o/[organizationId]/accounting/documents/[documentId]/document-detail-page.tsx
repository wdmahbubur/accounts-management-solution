import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { canEditFinancialDocument, readDraftOptions, readFinancialDocument } from "../../../../../../server/documents/service.ts";
import { canPostDocument } from "../../../../../../server/documents/posting.ts";
import { readInvoiceLifecycle } from "../../../../../../server/documents/invoice-register.ts";
import { readReceiptAllocationOptions, readReceiptLifecycle, type ReceiptInvoiceTarget } from "../../../../../../server/documents/customer-receipts.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";
import { listActiveMemberships } from "../../../../../../server/companies/memberships.ts";
import { OpeningSubmitAction } from "../opening-submit-action.tsx";
import { PostingAction } from "../posting-action.tsx";
import { ReverseDocumentAction } from "../reverse-document-action.tsx";
import { AllocationUnapplyAction } from "../allocation-unapply-action.tsx";
import { WriteOffSubmitAction } from "../write-off-submit-action.tsx";
import { InvoiceSendAction } from "./invoice-send-action.tsx";
import styles from "../documents.module.css";

export const dynamic="force-dynamic";export const revalidate=0;
export async function DocumentDetailPage({params}:{params:Promise<{organizationId:string;documentId:string}>}) {
  let organizationId;
  let documentId;
  try {
    const values = await params;
    organizationId = parseOrganizationId(values.organizationId);
    documentId = parseUuid(values.documentId);
  } catch {
    redirect("/companies?error=not_found");
  }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let actor: Awaited<ReturnType<typeof resolveActorContext>> | undefined;
  let document: Record<string, unknown> | undefined;
  let invoiceLifecycle: Awaited<ReturnType<typeof readInvoiceLifecycle>> | null = null;
  let receiptLifecycle: Awaited<ReturnType<typeof readReceiptLifecycle>> | null = null;
  let openingCompanyStatus:string|undefined;
  let openingOptions:{accounts:{id:string;code:string;name:string}[];parties:{id:string;display_name:string}[]}|undefined;
  let openingCutover: Record<string,unknown> | null = null;
  let options: DraftOptions | undefined;
  let receiptInvoices: ReceiptInvoiceTarget[] = [];
  let receiptInvoiceError = "";
  let failure: unknown;
  try {
    actor = await resolveActorContext(organizationId, runtime.dependencies);
    document = await readFinancialDocument(runtime.client, actor, documentId);
    const type = String(document.document_type);
    if(type === "opening_balance") {openingCompanyStatus=(await listActiveMemberships(runtime.client)).find(company=>company.organizationId===organizationId)?.organizationStatus;
      if(actor.capabilities.includes("journal.write")){const result=await runtime.client.rpc("list_opening_cutover_options",{p_organization_id:organizationId});if(!result.error&&result.data)openingOptions=result.data as typeof openingOptions;}}
    if (type === "opening_balance" && actor.capabilities.includes("accounting.read")) {
      const result = await runtime.client.rpc("read_opening_cutover_summary", { p_organization_id: organizationId, p_document_id: documentId });
      if (result.error) throw new Error("Opening cutover evidence could not be loaded.");
      if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) openingCutover = result.data as Record<string,unknown>;
    }
    if (type === "invoice" && actor.capabilities.includes("sales.read")) invoiceLifecycle = await readInvoiceLifecycle(runtime.client, actor, documentId);
    if (type === "receipt" && actor.capabilities.includes("sales.read")) receiptLifecycle = await readReceiptLifecycle(runtime.client, actor, documentId);
    if (type !== "opening_balance" && String(document.state) === "draft" && (sourceTypes as readonly string[]).includes(type) && canEditFinancialDocument(actor, type)) {
      const raw = await readDraftOptions(runtime.client, actor, type, String(document.accounting_date));
      options = {
        accounts: Array.isArray(raw.accounts) ? raw.accounts as DraftOptions["accounts"] : [],
        parties: Array.isArray(raw.parties) ? raw.parties as DraftOptions["parties"] : [],
        cash_accounts: Array.isArray(raw.cash_accounts) ? raw.cash_accounts as DraftOptions["cash_accounts"] : [],
        rounding_accounts: Array.isArray(raw.rounding_accounts) ? raw.rounding_accounts as DraftOptions["rounding_accounts"] : [],
        tax_codes: Array.isArray(raw.tax_codes) ? raw.tax_codes as DraftOptions["tax_codes"] : [],
        items: Array.isArray(raw.items) ? raw.items as DraftOptions["items"] : [],
        cost_centers: Array.isArray(raw.cost_centers) ? raw.cost_centers as DraftOptions["cost_centers"] : []
      };
      if (type === "receipt" && typeof document.party_id === "string") {
        try { receiptInvoices = await readReceiptAllocationOptions(runtime.client, actor, document.party_id, String(document.accounting_date)); }
        catch { receiptInvoiceError = "Eligible invoices could not be loaded. Your saved settlement targets are preserved. Refresh the invoice list to retry."; }
      }
    }
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof CommandError && failure.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (failure instanceof CommandError && failure.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (failure instanceof CommandError && failure.code === "FORBIDDEN") return <main><h1>Access denied</h1><p>You do not have permission to open this document.</p></main>;
    throw failure;
  }
  if (!actor || !document) throw new Error("Document response was empty.");

  const type = String(document.document_type);
  const canPost = String(document.state) === "approved" && canPostDocument(actor, type) && !(type === "opening_balance" && openingCompanyStatus === "onboarding");
  const canReverse = String(document.state) === "posted" && actor.capabilities.includes("journal.post") &&
    !document.reversed_by_document_id && !["reversal", "opening_balance", "year_close"].includes(type);
  return <main className={styles.main}>
    <p><Link href={type === "invoice" ? `/o/${organizationId}/sales/invoices` : `/o/${organizationId}/accounting/documents`}>← {type === "invoice" ? "Invoices" : "Financial documents"}</Link></p>
    {options && type !== "opening_balance" ? <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={type as SourceType} options={options} initial={document} expectedVersion={Number(document.version)} receiptInvoices={receiptInvoices} receiptInvoiceError={receiptInvoiceError} /> : <>
      <section className={`panel ${styles.panel}`}>
        <p className="eyebrow">{type}</p>
        <h1>{String(document.document_number ?? "Draft")}</h1>
        <p>State: {String(document.state)} · Accounting date: {String(document.accounting_date)}</p>
        <p>Total (BDT): {String(document.total_amount)}</p>
        <p>{String(document.description ?? "")}</p>
        {type === "opening_balance" && openingCutover && <section className="panel"><h2>Cutover evidence</h2><p>Imported summary as of {String(openingCutover.cutover_date)} · Source: {String(openingCutover.evidence_reference)}</p><p>Pre-cutover nominal balances are retained as summary data without historic transaction drilldown.</p><a className="secondary" href={`/api/v1/organizations/${organizationId}/documents/${documentId}/opening-cutover`}>Download cutover evidence JSON</a></section>}
        {type === "invoice" && invoiceLifecycle && <InvoiceSnapshot organizationId={organizationId} document={document} lifecycle={invoiceLifecycle} capabilities={actor.capabilities} />}
        {type === "receipt" && receiptLifecycle && <section aria-label="Receipt settlement" className="panel"><h2>Receipt settlement</h2><p>Applied: BDT {String(receiptLifecycle.applied_amount)} · Unused credit: BDT {String(receiptLifecycle.residual_amount ?? "0.00")}</p>{Array.isArray(receiptLifecycle.allocations) && receiptLifecycle.allocations.map((value, index) => {const allocation = value as Record<string, unknown>;return <p key={String(allocation.id ?? index)}>{String(allocation.effective_date)} · BDT {String(allocation.amount)} · {String(allocation.counter_document_number ?? "Invoice")}{!allocation.reversed_on && actor.capabilities.includes("dues.allocate") && <AllocationUnapplyAction organizationId={organizationId} allocationId={String(allocation.id)} />}</p>;})}</section>}
        {Array.isArray(document.lines) && document.lines.length > 0 && <LineSnapshotTable rows={document.lines as Record<string, unknown>[]} />}
      </section>
      {type === "opening_balance" && <section className="panel"><h2>Opening journal · BDT</h2><div className="table-scroll"><table><thead><tr><th>Account</th><th>Party</th><th>Description</th><th>Original reference</th><th>Due date</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{(Array.isArray(document.journal_rows)?document.journal_rows as Record<string,unknown>[]:[]).map((row,index)=><tr key={index}><td>{openingOptions?.accounts.find(account=>account.id===row.account_id)?.name??String(row.account_id)}</td><td>{openingOptions?.parties.find(party=>party.id===row.party_id)?.display_name??String(row.party_id??"—")}</td><td>{String(row.description)}</td><td>{String(row.open_item_reference??"—")}</td><td>{String(row.open_item_due_date??"—")}</td><td>{String(row.debit)}</td><td>{String(row.credit)}</td></tr>)}</tbody></table></div>
        {document.state === "draft" && actor.capabilities.includes("journal.write") && actor.capabilities.includes("accounting.read") && <p><Link href={`/o/${organizationId}/settings/opening-balances?document=${documentId}`}>Edit balances and cutover evidence</Link></p>}
        {actor.capabilities.includes("accounting.read")&&!openingCutover&&<p>Add the source trial-balance evidence in the cutover workspace before requesting approval.</p>}
        <p><Link href={`/o/${organizationId}/settings/approvals`}>Configure opening approval</Link> · <Link href={`/o/${organizationId}/approvals`}>Review approval requests</Link></p>
        {openingCompanyStatus === "onboarding" && <p>{actor.capabilities.includes("company.update")?<Link href={`/o/${organizationId}/settings/setup`}>Return to company setup to activate and post the approved opening</Link>:"A company owner completes setup after this opening is approved."}</p>}
      </section>}
      {type === "opening_balance" && document.state === "draft" && (openingCutover || !actor.capabilities.includes("accounting.read")) && actor.capabilities.includes("journal.write") && <OpeningSubmitAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} />}
      {type === "write_off" && document.state === "draft" && <WriteOffSubmitAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} />}
      {canPost && <PostingAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} />}
      {canReverse && <ReverseDocumentAction organizationId={organizationId} documentId={documentId} sourceDate={String(document.accounting_date)} />}
    </>}
  </main>;
}
export default DocumentDetailPage;
function LineSnapshotTable({rows}:{rows:Record<string,unknown>[]}){return <div className="table-scroll"><table><thead><tr><th>Description</th><th>Item snapshot</th><th>SKU snapshot</th><th>Quantity</th><th>Unit</th><th>Unit rate</th><th>Tax snapshot</th><th>Net</th><th>Tax</th><th>Gross</th><th>Cost center</th></tr></thead><tbody>{rows.map((row,index)=>{const item=row.item_snapshot&&typeof row.item_snapshot==="object"?row.item_snapshot as Record<string,unknown>:{};const center=row.cost_center_snapshot&&typeof row.cost_center_snapshot==="object"?row.cost_center_snapshot as Record<string,unknown>:{};return <tr key={String(row.id??index)}><td>{String(row.description)}</td><td>{String(item.name??"—")}</td><td>{String(item.sku??"—")}</td><td>{String(row.quantity)}</td><td>{String(item.unit??"—")}</td><td>{String(row.unit_price)}</td><td>{String(row.tax_label_snapshot??"No tax")} · {String(row.tax_rate_snapshot??"0")}%</td><td>{String(row.net_amount)}</td><td>{String(row.tax_amount)}</td><td>{String(row.gross_amount)}</td><td>{center.id?`${String(center.code)} · ${String(center.name)}`:"—"}</td></tr>;})}</tbody></table></div>;}
function InvoiceSnapshot({organizationId,document,lifecycle,capabilities}:{organizationId:string;document:Record<string,unknown>;lifecycle:Record<string,unknown>;capabilities:readonly string[]}){
 const party=document.party_snapshot&&typeof document.party_snapshot==="object"?document.party_snapshot as Record<string,unknown>:{};
 const trade=document.trade&&typeof document.trade==="object"?document.trade as Record<string,unknown>:{};
 const rows=(key:string)=>Array.isArray(lifecycle[key])?lifecycle[key] as Record<string,unknown>[]:[];
 const allocations=rows("allocations"),deliveries=rows("delivery_attempts"),approvals=rows("approvals"),corrections=rows("corrections"),attachments=rows("attachments"),activity=rows("activity");
 const journal=document.posted_journal&&typeof document.posted_journal==="object"?document.posted_journal as Record<string,unknown>:null;
 const total=String(document.total_amount??"0.00");const balance=lifecycle.residual_amount===null?"—":String(lifecycle.residual_amount);
 return <><section aria-label="Invoice source, settlement and delivery status" className="panel"><h2>Invoice status</h2><p>Source: {String(lifecycle.state)} · Settlement: {String(lifecycle.settlement_status).replaceAll("_"," ")} · Delivery: {deliveries.length?String(deliveries.at(-1)?.status):"not sent"}</p><p>Total: BDT {total} · Residual: BDT {balance} {lifecycle.overdue===true&&<strong>· Overdue</strong>}</p><p>Recognition: {String(trade.recognition_mode??"earned_or_incurred").replaceAll("_"," ")} · Performance confirmed: {trade.performance_confirmed===true?"Yes":"No"}</p><h3>Issued customer snapshot</h3><p>{String(party.display_name??"Customer unavailable")} · {String(party.legal_name??"")}</p><p>{String(party.email??"")} · {String(party.phone??"")}</p><pre>{JSON.stringify({billing_address:party.billing_address??{},tax_identifiers:party.tax_identifiers??{}},null,2)}</pre>
  {String(lifecycle.state)==="posted"&&<div className="toolbar"><a className="secondary" href={`/api/v1/organizations/${organizationId}/invoices/${String(document.id)}/pdf`}>Download issued PDF</a>{capabilities.includes("sales.write")&&<InvoiceSendAction organizationId={organizationId} documentId={String(document.id)} />}<Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=receipt&party_id=${String(document.party_id)}`}>Record customer receipt</Link><Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=customer_credit&party_id=${String(document.party_id)}&original_document_id=${String(document.id)}`}>Issue customer credit</Link></div>}
 </section><section className="panel"><h2>Payments and credits</h2>{allocations.length===0?<p>No settlement allocations are linked.</p>:<div className="table-scroll"><table><thead><tr><th>Date</th><th>Source</th><th>Allocated (BDT)</th><th>Allocation state</th></tr></thead><tbody>{allocations.map(a=><tr key={String(a.id)}><td>{String(a.effective_date)}</td><td>{String(a.counter_document_number??a.counter_document_type)}</td><td>{String(a.amount)}</td><td>{a.reversed_on?`Reversed ${String(a.reversed_on)}`:"Active"}</td></tr>)}</tbody></table></div>}</section>
 <section className="panel"><h2>Delivery attempts</h2>{deliveries.length?deliveries.map((item,i)=><p key={String(item.created_at??i)}>{String(item.channel)} · {String(item.status)} · {String(item.created_at)}{item.delivered_at?` · delivered ${String(item.delivered_at)}`:""}</p>):<p>No delivery attempt recorded. Email delivery never changes invoice posting state.</p>}</section>
 {capabilities.includes("approvals.read")&&<section className="panel"><h2>Approval history</h2>{approvals.length?approvals.map(request=><div key={String(request.id)}><p>{String(request.state)} · version {String(request.version)} · {String(request.created_at)}</p>{Array.isArray(request.decisions)&&(request.decisions as Record<string,unknown>[]).map((decision,i)=><p key={i}>{String(decision.decision)} · {String(decision.decided_by)} · {String(decision.created_at)}{decision.reason?` · ${String(decision.reason)}`:""}</p>)}</div>):<p>No approval request.</p>}</section>}
 <section className="panel"><h2>Corrections</h2>{corrections.length?corrections.map(row=><p key={String(row.id)}><Link href={`/o/${organizationId}/accounting/documents/${String(row.id)}`}>{String(row.document_number??row.document_type)}</Link> · {String(row.state)} · {String(row.accounting_date)} · {String(row.reason??"")}</p>):<p>No linked reversal or correction document.</p>}</section>
 {capabilities.includes("attachments.read")&&<section className="panel"><h2>Attachments</h2>{attachments.length?attachments.map(a=><p key={String(a.id)}>{String(a.filename)} · {String(a.content_type)} · {String(a.byte_size)} bytes · {String(a.scan_status)}</p>):<p>No attached evidence.</p>}</section>}
 {capabilities.includes("audit.read")&&<section className="panel"><h2>Activity</h2>{activity.length?activity.map((event,i)=><p key={i}>{String(event.action)} · {String(event.actor_kind)} · {String(event.created_at)}{event.reason?` · ${String(event.reason)}`:""}</p>):<p>No activity recorded.</p>}</section>}
 {capabilities.includes("ledger.read")&&<section className="panel"><h2>Accounting</h2>{journal?<><p>Posted journal {String(journal.id)} · {String(journal.accounting_date)}</p><table><thead><tr><th>Account ID</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{(Array.isArray(journal.lines)?journal.lines as Record<string,unknown>[]:[]).map((line,i)=><tr key={i}><td>{String(line.account_id)}</td><td>{String(line.debit)}</td><td>{String(line.credit)}</td></tr>)}</tbody></table></>:<p>No posted journal is linked.</p>}</section>}</>;
}
