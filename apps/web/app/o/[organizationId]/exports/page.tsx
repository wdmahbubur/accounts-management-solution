import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { ExportJobs } from "./export-jobs.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExportsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let canRequest = false;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("exports.read")) throw CommandError.forbidden();
    canRequest = actor.capabilities.includes("reports.export") && actor.capabilities.includes("reports.read") &&
      actor.capabilities.includes("accounting.read") && actor.capabilities.includes("ledger.read");
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need exports.read to view export jobs.</p></main>;
    throw error;
  }
  return <ExportJobs organizationId={organizationId} canRequest={canRequest} />;
}
