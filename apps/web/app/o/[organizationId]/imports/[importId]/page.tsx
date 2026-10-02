import Link from "next/link";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { notFound, redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { ContactImportClient } from "../contact-import-client.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ContactImportDetailPage({ params }: { params: Promise<{ organizationId: string; importId: string }> }) {
  let organizationId: string; let importId: string;
  try { const values = await params; organizationId = parseOrganizationId(values.organizationId); importId = parseUuid(values.importId); }
  catch { notFound(); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const result = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: importId });
    let values = Array.isArray(result.data) ? result.data : [];
    if (!values.length) {
      const itemResult = await runtime.client.rpc("read_item_import", { p_organization_id: organizationId, p_import_job_id: importId });
      if (itemResult.error) throw itemResult.error;
      values = Array.isArray(itemResult.data) ? itemResult.data : [];
      if (!values.length) {
        const draftResult = await runtime.client.rpc("read_financial_draft_import", { p_organization_id: organizationId, p_import_job_id: importId });
        if (draftResult.error || !Array.isArray(draftResult.data) || !draftResult.data.length) notFound();
        values = draftResult.data;
      }
    }
    const jobs = values as Parameters<typeof ContactImportClient>[0]["jobs"];
    return <main className="content"><p className="eyebrow">Data tools</p><h1>Import job preview</h1>
      <p>Review staged rows and any row-level validation or command errors before retrying.</p>
      <p><Link href={`/o/${organizationId}/imports`}>Back to imports</Link></p>
      <ContactImportClient organizationId={organizationId} nonce={runtime.current.nonce} jobs={jobs}
        canImportContacts={actor.capabilities.includes("imports.run") && actor.capabilities.includes("contacts.write")}
        canImportItems={actor.capabilities.includes("imports.run") && actor.capabilities.includes("catalog.write")}
        canImportInvoices={actor.capabilities.includes("imports.run") && actor.capabilities.includes("documents.read") && actor.capabilities.includes("sales.write")}
        canImportBills={actor.capabilities.includes("imports.run") && actor.capabilities.includes("documents.read") && actor.capabilities.includes("purchases.write")} />
    </main>;
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need imports.read to view this import.</p></main>;
    throw error;
  }
}
