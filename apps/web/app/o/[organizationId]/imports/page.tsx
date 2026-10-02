import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { ContactImportClient } from "./contact-import-client.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function ImportsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId: string;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const result = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: null });
    if (result.error) throw result.error;
    const items = await runtime.client.rpc("read_item_import", { p_organization_id: organizationId, p_import_job_id: null });
    if (items.error) throw items.error;
    const jobs = ([...(Array.isArray(result.data) ? result.data : []), ...(Array.isArray(items.data) ? items.data : [])]
      .sort((left, right) => Date.parse(String((right as Record<string, unknown>).created_at)) - Date.parse(String((left as Record<string, unknown>).created_at)))) as Parameters<typeof ContactImportClient>[0]["jobs"];
    return <main className="content"><p className="eyebrow">Data tools</p><h1>Import jobs</h1>
      <p>Stage, map and review contact or service-item CSV rows before explicitly committing them. Imports stay scoped to this company and your account.</p>
      <ContactImportClient organizationId={organizationId} nonce={runtime.current.nonce} jobs={jobs}
        canImportContacts={actor.capabilities.includes("imports.run") && actor.capabilities.includes("contacts.write")}
        canImportItems={actor.capabilities.includes("imports.run") && actor.capabilities.includes("catalog.write")} />
    </main>;
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need imports.read to view import jobs.</p></main>;
    throw error;
  }
}
