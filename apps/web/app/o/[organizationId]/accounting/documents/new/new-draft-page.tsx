import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { bangladeshDate } from "../../../../../../lib/date.ts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions, readFinancialDocument } from "../../../../../../server/documents/service.ts";
import { readReceiptAllocationOptions } from "../../../../../../server/documents/customer-receipts.ts";
import { readSupplierPaymentAllocationOptions } from "../../../../../../server/documents/supplier-payments.ts";
import { readCreditNoteOptions, type CreditNoteOptions } from "../../../../../../server/documents/credit-notes.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";
import { duplicateTradeDraft } from "../draft-interactions.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewDraftPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ type?: string; party_id?: string; copy?: string; original_document_id?: string }>;
}) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const query = await searchParams;
  if (!query.type || !(sourceTypes as readonly string[]).includes(query.type)) redirect(`/o/${organizationId}/accounting/documents`);
  const documentType = query.type as SourceType;
  const today = bangladeshDate();
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let options: DraftOptions | undefined;
  let receiptInvoices: Awaited<ReturnType<typeof readReceiptAllocationOptions>> = [];
  let receiptInvoiceError = "";
  let supplierBills: Awaited<ReturnType<typeof readSupplierPaymentAllocationOptions>> = [];
  let supplierBillError = "";
  let creditSources: CreditNoteOptions | undefined;
  let creditSourceError = "";
  let initial: Record<string, unknown> | undefined = query.party_id ? { party_id: query.party_id } : undefined;
  let duplicate = false;
  let forbidden = false;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if(documentType === "opening_balance") {
      if(!["journal.write","documents.read","accounting.read"].every(capability=>actor.capabilities.includes(capability))) throw CommandError.forbidden();
      redirect(`/o/${organizationId}/settings/opening-balances`);
    }
    const raw = await readDraftOptions(runtime.client, actor, documentType, today);
    options = {
      accounts: Array.isArray(raw.accounts) ? raw.accounts as DraftOptions["accounts"] : [],
      parties: Array.isArray(raw.parties) ? raw.parties as DraftOptions["parties"] : [],
      cash_accounts: Array.isArray(raw.cash_accounts) ? raw.cash_accounts as DraftOptions["cash_accounts"] : [],
      rounding_accounts: Array.isArray(raw.rounding_accounts) ? raw.rounding_accounts as DraftOptions["rounding_accounts"] : [],
      tax_codes: Array.isArray(raw.tax_codes) ? raw.tax_codes as DraftOptions["tax_codes"] : [],
      items: Array.isArray(raw.items) ? raw.items as DraftOptions["items"] : [],
      cost_centers: Array.isArray(raw.cost_centers) ? raw.cost_centers as DraftOptions["cost_centers"] : []
    };
    if (initial?.party_id && !options.parties.some(party => party.id === initial?.party_id)) initial = undefined;
    const selectedParty = typeof initial?.party_id === "string" ? initial.party_id : null;
    if (documentType === "receipt" && selectedParty) {
      try { receiptInvoices = await readReceiptAllocationOptions(runtime.client, actor, selectedParty, today); }
      catch { receiptInvoiceError = "Eligible invoices could not be loaded. Refresh the invoice list to retry."; }
    }
    if (documentType === "vendor_payment" && selectedParty) {
      try { supplierBills = await readSupplierPaymentAllocationOptions(runtime.client, actor, selectedParty, today); }
      catch { supplierBillError = "Eligible bills could not be loaded. Refresh the bill list to retry. Viewing bill balances requires dues.read."; }
    }
    if (query.original_document_id && documentType !== "customer_credit" && documentType !== "vendor_credit") throw CommandError.notFound();
    if (documentType === "customer_credit" || documentType === "vendor_credit") {
      if (query.original_document_id) {
        let originalDocumentId;
        try { originalDocumentId = parseUuid(query.original_document_id, "original_document_id"); }
        catch { throw CommandError.notFound(); }
        initial = { ...initial, trade: { original_document_id: originalDocumentId } };
      }
      try {
        creditSources = await readCreditNoteOptions(runtime.client, actor, { documentType, accountingDate: today, partyId: selectedParty, originalDocumentId: query.original_document_id });
        const original = creditSources.selectedSource;
        if (original) initial = { party_id: original.partyId, trade: { original_document_id: original.id } };
      } catch {
        creditSourceError = "Original documents could not be loaded. Refresh the source list before preparing a credit.";
      }
    }
    if (query.copy) {
      if (documentType !== "invoice" && documentType !== "bill") throw CommandError.validation({ copy: "Only an invoice or supplier bill can be duplicated as a draft." });
      const source = await readFinancialDocument(runtime.client, actor, query.copy);
      if (source.document_type !== documentType) throw CommandError.notFound();
      initial = duplicateTradeDraft(source, documentType, today);
      duplicate = true;
    }
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true;
    else failure = error;
  }
  if (forbidden) return <main><h1>Access denied</h1><p>You do not have permission to create this source type.</p></main>;
  if (failure) throw failure;
  if (!options) throw new Error("Document draft options were unavailable.");
  const creationIdentity = JSON.stringify([organizationId, documentType, query.party_id ?? null, query.copy ?? null, query.original_document_id ?? null]);
  return <main><DraftEditor key={creationIdentity} organizationId={organizationId} nonce={runtime.current.nonce} documentType={documentType} options={options} initial={initial} duplicate={duplicate} createNew={!!initial}
    receiptInvoices={receiptInvoices} receiptInvoiceError={receiptInvoiceError} supplierBills={supplierBills} supplierBillError={supplierBillError}
    creditSources={creditSources} creditSourceError={creditSourceError} defaultDate={today} /></main>;
}
