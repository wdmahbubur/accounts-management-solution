import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";

import { bangladeshDate } from "../../../../../../lib/date.ts";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions } from "../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";

function draftOptions(value: Record<string, unknown>): DraftOptions {
  return {
    accounts: Array.isArray(value.accounts) ? value.accounts as DraftOptions["accounts"] : [],
    parties: Array.isArray(value.parties) ? value.parties as DraftOptions["parties"] : [],
    cash_accounts: Array.isArray(value.cash_accounts) ? value.cash_accounts as DraftOptions["cash_accounts"] : [],
    rounding_accounts: Array.isArray(value.rounding_accounts) ? value.rounding_accounts as DraftOptions["rounding_accounts"] : [],
    tax_codes: Array.isArray(value.tax_codes) ? value.tax_codes as DraftOptions["tax_codes"] : [],
    items: Array.isArray(value.items) ? value.items as DraftOptions["items"] : [],
    cost_centers: Array.isArray(value.cost_centers) ? value.cost_centers as DraftOptions["cost_centers"] : []
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewDraftPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ type?: string; party_id?: string }>;
}) {
  let organizationId;
  try {
    organizationId = parseOrganizationId((await params).organizationId);
  } catch {
    redirect("/companies?error=not_found");
  }

  const query = await searchParams;
  const requested = query.type;
  if (!requested || !(sourceTypes as readonly string[]).includes(requested)) {
    redirect(`/o/${organizationId}/accounting/documents`);
  }
  const documentType = requested as SourceType;
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");

  let options: DraftOptions | undefined;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const raw = await readDraftOptions(runtime.client, actor, documentType, bangladeshDate());
    options = draftOptions(raw);
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof CommandError && failure.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (failure instanceof CommandError && failure.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (failure instanceof CommandError && failure.code === "FORBIDDEN") {
      return <main><h1>Access denied</h1><p>You do not have permission to create this source type.</p></main>;
    }
    throw failure;
  }

  const selectedParty = query.party_id && options!.parties.some((party) => party.id === query.party_id) ? query.party_id : null;
  return <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={documentType} options={options!}
    initial={selectedParty ? { party_id: selectedParty } : undefined} />;
}
