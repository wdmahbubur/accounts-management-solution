import { parseOrganizationId } from "@ams/contracts";
import { bangladeshDate } from "../../../../../../lib/date.ts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions, readFinancialDocument } from "../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";

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
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let options: DraftOptions | undefined;
  let initial: Record<string, unknown> | undefined = query.party_id ? { party_id: query.party_id } : undefined;
  let duplicate = false;
  let forbidden = false;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const raw = await readDraftOptions(runtime.client, actor, documentType, bangladeshDate());
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
    if (query.original_document_id) {
      const original = await readFinancialDocument(runtime.client, actor, query.original_document_id);
      if (original.document_type !== "invoice" || documentType !== "customer_credit") throw CommandError.notFound();
      initial = { ...(initial ?? {}), trade: { original_document_id: query.original_document_id } };
    }
    if (query.copy) {
      if (documentType !== "invoice") throw CommandError.validation({ copy: "Only an invoice can be copied into a new invoice draft." });
      const source = await readFinancialDocument(runtime.client, actor, query.copy);
      if (source.document_type !== "invoice") throw CommandError.notFound();
      const rows = Array.isArray(source.lines) ? source.lines : [];
      const sourceTrade = source.trade && typeof source.trade === "object" ? source.trade as Record<string, unknown> : {};
      initial = {
        ...source,
        id: undefined,
        document_number: undefined,
        state: "draft",
        posted_journal: undefined,
        trade: { ...sourceTrade, original_document_id: null, performance_confirmed: false },
        lines: rows.map(value => {
          const line = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return { ...line, id: null, original_line_id: null };
        })
      };
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
  return <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={documentType} options={options} initial={initial} duplicate={duplicate} createNew={!!initial} />;
}
