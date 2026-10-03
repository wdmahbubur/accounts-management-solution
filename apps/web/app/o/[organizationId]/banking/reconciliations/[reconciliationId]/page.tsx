import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { ReconciliationWorkspace } from "./workspace.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ReconciliationPage({ params }: { params: Promise<{ organizationId: string; reconciliationId: string }> }) {
  let organizationId; let reconciliationId;
  try { const values = await params; organizationId = parseOrganizationId(values.organizationId); reconciliationId = parseUuid(values.reconciliationId); }
  catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let workspace: Record<string, unknown> = {};
  let canWrite = false;
  let canFinalize = false;
  let canReopen = false;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    canWrite = actor.capabilities.includes("banking.write");
    canFinalize = actor.capabilities.includes("periods.lock");
    canReopen = actor.capabilities.includes("periods.reopen");
    const result = await runtime.client.rpc("read_reconciliation_workspace", { p_organization_id: organizationId, p_reconciliation_id: reconciliationId });
    if (result.error) {
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      throw new Error("Reconciliation could not be loaded.");
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("Invalid reconciliation response.");
    workspace = result.data as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need banking.read to view reconciliations.</p></main>;
    throw error;
  }
  return <ReconciliationWorkspace organizationId={organizationId} data={workspace} canWrite={canWrite} canFinalize={canFinalize} canReopen={canReopen}/>;
}
