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
import { bangladeshDate } from "../../../../../../lib/date.ts";
import {
  CashMovementDetails, Disclosure, DocumentFacts, DocumentHeader, DocumentHistory, DocumentItems,
  DocumentTechnicalDetails, JournalTable, PlannedSettlements
} from "../../../../../../components/finance/document-detail.tsx";
import {
  detailDate, detailRecord, detailRows, detailText, documentList, humanLabel, invoiceDetailActions, type DetailRecord
} from "../../../../../../components/finance/document-detail-model.ts";
import { displayMoney } from "../../../../../../components/finance/contracts.ts";
import styles from "../../../../../../components/finance/document-detail.module.css";

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

  let openingCutover: Record<string,unknown> | null = null;
  let options: DraftOptions | undefined;
  let receiptInvoices: ReceiptInvoiceTarget[] = [];
  let receiptInvoiceError = "";
  let failure: unknown;
  try {
    actor = await resolveActorContext(organizationId, runtime.dependencies);
    document = await readFinancialDocument(runtime.client, actor, documentId);
    const type = String(document.document_type);
    if (type === "opening_balance") openingCompanyStatus = (await listActiveMemberships(runtime.client)).find(company => company.organizationId === organizationId)?.organizationStatus;
    if (type === "opening_balance" && actor.capabilities.includes("accounting.read")) {
      const result = await runtime.client.rpc("read_opening_cutover_summary", { p_organization_id: organizationId, p_document_id: documentId });
      if (result.error) throw new Error("Opening cutover evidence could not be loaded.");
      if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) openingCutover = result.data as Record<string,unknown>;
    }
    if (type === "invoice" && actor.capabilities.includes("sales.read")) invoiceLifecycle = await readInvoiceLifecycle(runtime.client, actor, documentId);
    if (type === "receipt" && actor.capabilities.includes("sales.read")) receiptLifecycle = await readReceiptLifecycle(runtime.client, actor, documentId);
    if (type !== "opening_balance" && String(document.state) === "draft" && (sourceTypes as readonly string[]).includes(type) && canEditFinancialDocument(actor, type) && actor.capabilities.includes("documents.read")) {
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
  const capabilities = actor.capabilities;
  const has = (...codes: string[]) => codes.every(code => capabilities.includes(code));
  const list = documentList(organizationId, type, capabilities);
  const canPost = document.state === "approved" && canPostDocument(actor, type) && !(type === "opening_balance" && openingCompanyStatus === "onboarding");
  const canReverse = document.state === "posted" && has("journal.post") &&
    !document.reversed_by_document_id && !["reversal", "opening_balance", "year_close"].includes(type);
  const invoiceActions = invoiceDetailActions(document, capabilities);
  const canRecordReceipt = invoiceActions.recordReceipt && invoiceLifecycle?.residual_amount !== "0.00";
  const canEditOpening = type === "opening_balance" && document.state === "draft" && has("journal.write", "documents.read", "accounting.read");
  const canReviewApproval = document.state === "pending_approval" && has("approvals.read");
  const hasHeaderActions = invoiceActions.downloadPdf || invoiceActions.sendEmail || canRecordReceipt || invoiceActions.issueCredit || canEditOpening || canReviewApproval;
  const journal = has("ledger.read") ? detailRecord(document.posted_journal) : {};
  const savedRows = detailRows(document.journal_rows);
  const primaryJournal = type !== "opening_balance" && savedRows.length > 0;
  const lifecycle = invoiceLifecycle ?? receiptLifecycle;
  const back = <Link className={styles.back} href={list.href}>← {list.label}</Link>;

  if (options && type !== "opening_balance") return <main className={styles.main}>{back}
    <DocumentHeader document={document} invoiceLifecycle={null} receiptLifecycle={null} amountLabel="Last saved total" />
    <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={type as SourceType} options={options}
      initial={document} expectedVersion={Number(document.version)} receiptInvoices={receiptInvoices} receiptInvoiceError={receiptInvoiceError} />
  </main>;

  return <main className={styles.main}>
    {back}
    <DocumentHeader document={document} invoiceLifecycle={invoiceLifecycle} receiptLifecycle={receiptLifecycle} actions={hasHeaderActions ? <>
      {invoiceActions.downloadPdf ? <a className="secondary" href={`/api/v1/organizations/${organizationId}/invoices/${documentId}/pdf`}>Download issued PDF</a> : null}
      {invoiceActions.sendEmail ? <InvoiceSendAction organizationId={organizationId} documentId={documentId} /> : null}
      {canRecordReceipt ? <Link className="primary" href={`/o/${organizationId}/accounting/documents/new?type=receipt&party_id=${String(document.party_id)}`}>Record customer receipt</Link> : null}
      {invoiceActions.issueCredit ? <Link className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=customer_credit&party_id=${String(document.party_id)}&original_document_id=${documentId}`}>Issue customer credit</Link> : null}
      {canEditOpening ? <Link className="primary" href={`/o/${organizationId}/settings/opening-balances?document=${documentId}`}>Edit opening balances</Link> : null}
      {canReviewApproval ? <Link className="primary" href={`/o/${organizationId}/approvals`}>Review approval request</Link> : null}
    </> : null} />

    {document.reversed_by_document_id ? <p className={styles.notice}>This document has a linked reversal{has("documents.read") ? <>: <Link href={`/o/${organizationId}/accounting/documents/${String(document.reversed_by_document_id)}`}>{detailText(document.reversed_by_document_number, "Open reversal")}</Link></> : "."}</p> : null}
    {document.reversal_of_document_id ? <p className={styles.notice}>Reversal of <Link href={`/o/${organizationId}/accounting/documents/${String(document.reversal_of_document_id)}`}>{detailText(document.reversal_of_document_number, "the original document")}</Link>. Both events remain in the ledger.</p> : null}
    {canPost ? <div className={styles.commandArea}><PostingAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} /></div> : null}

    <DocumentFacts document={document} />
    <DocumentItems document={document} />
    <CashMovementDetails document={document} />

    {invoiceLifecycle ? <SettlementSection organizationId={organizationId} lifecycle={invoiceLifecycle} title="Payments and credits" canUnapply={false} /> : null}
    {receiptLifecycle && document.state === "posted" ? <SettlementSection organizationId={organizationId} lifecycle={receiptLifecycle} title="Receipt settlement" canUnapply={has("dues.allocate")} /> : null}
    {!(type === "receipt" && document.state === "posted" && receiptLifecycle) ? <PlannedSettlements organizationId={organizationId} document={document} /> : null}

    {primaryJournal ? <section className={styles.section} aria-labelledby="saved-journal-title"><h2 id="saved-journal-title">{journal.id ? "Posted journal" : "Saved journal lines"}</h2>
      <JournalTable rows={journal.id ? detailRows(journal.lines) : savedRows} caption={journal.id ? `Posted ${detailDate(journal.accounting_date)}` : "Saved source lines"} />
    </section> : null}

    {type === "opening_balance" ? <>
      <section className={styles.section} aria-labelledby="opening-journal-title"><h2 id="opening-journal-title">Opening balances</h2><JournalTable rows={savedRows} caption="Opening source lines" />
        {openingCompanyStatus === "onboarding" ? <p className={styles.notice}>{has("company.update") ? <Link href={`/o/${organizationId}/settings/setup`}>Return to company setup to activate and post the approved opening</Link> : "A company owner completes setup after this opening is approved."}</p> : null}
        <div className={styles.related}>
          {has("approvals.manage") ? <Link href={`/o/${organizationId}/settings/approvals`}>Configure opening approval</Link> : null}
          {has("approvals.read") ? <Link href={`/o/${organizationId}/approvals`}>Review approval requests</Link> : null}
        </div>
      </section>
      {openingCutover ? <section className={styles.section} aria-labelledby="cutover-evidence-title"><h2 id="cutover-evidence-title">Cutover evidence</h2>
        <dl className={styles.facts}><div><dt>Cutover date</dt><dd>{detailDate(openingCutover.cutover_date)}</dd></div><div><dt>Source reference</dt><dd>{detailText(openingCutover.evidence_reference)}</dd></div></dl>
        <p className={styles.hint}>Pre-cutover balances are retained as imported summaries. Historic transaction drilldown is not available for those summaries.</p>
        <a className="secondary" href={`/api/v1/organizations/${organizationId}/documents/${documentId}/opening-cutover`}>Download cutover evidence</a>
      </section> : has("accounting.read") ? <p className={styles.notice}>Add the source trial-balance evidence in the cutover workspace before requesting approval.</p> : null}
      {document.state === "draft" && (openingCutover || !has("accounting.read")) && has("journal.write", "documents.read") ? <div className={styles.commandArea}><OpeningSubmitAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} /></div> : null}
    </> : null}
    {type === "write_off" && document.state === "draft" && has("dues.adjust", "documents.read") ? <div className={styles.commandArea}><WriteOffSubmitAction organizationId={organizationId} documentId={documentId} version={Number(document.version)} /></div> : null}

    {has("ledger.read") && !primaryJournal ? <Disclosure id="document-accounting" title="Accounting" count={journal.id ? detailRows(journal.lines).length : undefined}>
      {journal.id ? <JournalTable rows={detailRows(journal.lines)} caption={`Posted journal · ${detailDate(journal.accounting_date)}`} /> : <p className={styles.hint}>No posted journal is linked. Drafts and approvals do not affect the ledger.</p>}
    </Disclosure> : null}
    <DocumentHistory organizationId={organizationId} lifecycle={lifecycle} capabilities={capabilities} />
    {canReverse ? <Disclosure title="Correct or reverse this document"><ReverseDocumentAction organizationId={organizationId} documentId={documentId} sourceDate={String(document.accounting_date)} defaultDate={bangladeshDate()} /></Disclosure> : null}
    <DocumentTechnicalDetails document={document} showJournal={has("ledger.read")} />
  </main>;
}
export default DocumentDetailPage;

function SettlementSection({ organizationId, lifecycle, title, canUnapply }: {
  organizationId: string; lifecycle: DetailRecord; title: string; canUnapply: boolean;
}) {
  const allocations = detailRows(lifecycle.allocations);
  return <section className={styles.section} aria-label={title}><h2>{title}</h2>
    {allocations.length ? <div className={styles.tableScroll}><table><caption>Linked settlement history · BDT</caption><thead><tr><th scope="col">Effective date</th><th scope="col">Source</th><th scope="col">Amount</th><th scope="col">Allocation state</th>{canUnapply ? <th scope="col">Correction</th> : null}</tr></thead>
      <tbody>{allocations.map((allocation, index) => <tr key={detailText(allocation.id, String(index))}>
        <td>{detailDate(allocation.effective_date)}</td><td>{allocation.counter_document_id ? <Link href={`/o/${organizationId}/accounting/documents/${String(allocation.counter_document_id)}`}>{detailText(allocation.counter_document_number, humanLabel(allocation.counter_document_type))}</Link> : detailText(allocation.counter_document_number, humanLabel(allocation.counter_document_type))}</td>
        <td className={styles.amount}>{displayMoney(allocation.amount)}</td><td>{allocation.reversed_on ? `Reversed effective ${detailDate(allocation.reversed_on)}` : "Active"}</td>
        {canUnapply ? <td className={styles.allocationAction}>{!allocation.reversed_on ? <AllocationUnapplyAction organizationId={organizationId} allocationId={String(allocation.id)} /> : "—"}</td> : null}
      </tr>)}</tbody></table></div> : <p className={styles.hint}>{lifecycle.state === "posted" ? "No settlement allocation is linked to this document." : "Settlement will be available after posting."}</p>}
  </section>;
}
