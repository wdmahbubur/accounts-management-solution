import { parseOrganizationId, parseUuid } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions, readFinancialDocument } from "../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";
import styles from "../documents.module.css";

function draftOptions(value: Record<string, unknown>): DraftOptions {
  return {
    accounts: Array.isArray(value.accounts) ? value.accounts as DraftOptions["accounts"] : [],
    parties: Array.isArray(value.parties) ? value.parties as DraftOptions["parties"] : [],
    cash_accounts: Array.isArray(value.cash_accounts) ? value.cash_accounts as DraftOptions["cash_accounts"] : [],
    rounding_accounts: Array.isArray(value.rounding_accounts) ? value.rounding_accounts as DraftOptions["rounding_accounts"] : [],
    tax_codes: Array.isArray(value.tax_codes) ? value.tax_codes as DraftOptions["tax_codes"] : []
  };
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DocumentDetailPage({ params }: {
  params: Promise<{ organizationId: string; documentId: string }>;
}) {
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

  let document: Record<string, unknown> | undefined;
  let options: DraftOptions | undefined;
  let failure: unknown;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    document = await readFinancialDocument(runtime.client, actor, documentId);
    const documentType = String(document.document_type);
    const canEdit = !["posted", "void"].includes(String(document.state)) &&
      (sourceTypes as readonly string[]).includes(documentType);
    if (canEdit) {
      const raw = await readDraftOptions(runtime.client, actor, documentType, String(document.accounting_date));
      options = draftOptions(raw);
    }
  } catch (error) {
    failure = error;
  }

  if (failure) {
    if (failure instanceof CommandError && failure.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (failure instanceof CommandError && failure.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (failure instanceof CommandError && failure.code === "FORBIDDEN") {
      return <main><h1>Access denied</h1><p>You do not have permission to open this document.</p></main>;
    }
    throw failure;
  }
  if (!document) throw new Error("Document response was empty.");

  const documentType = String(document.document_type);
  const canEdit = options !== undefined;
  return (
    <main className={styles.main}>
      <p><Link href={`/o/${organizationId}/accounting/documents`}>← Financial documents</Link></p>
      {canEdit ? (
        <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce}
          documentType={documentType as SourceType} options={options!} initial={document}
          expectedVersion={Number(document.version)} />
      ) : (
        <section className={`panel ${styles.panel}`}>
          <p className="eyebrow">{documentType}</p>
          <h1>{typeof document.document_number === "string" ? document.document_number : "Draft"}</h1>
          <p>State: {String(document.state)} · Accounting date: {String(document.accounting_date)}</p>
          <p>Total (BDT): {String(document.total_amount)}</p>
          <p>This source is read-only in its current state.</p>
        </section>
      )}
    </main>
  );
}
