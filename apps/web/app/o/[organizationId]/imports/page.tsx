import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { MasterDataImports } from "./master-data-imports.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ImportsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let actor;
  try {
    actor = await resolveActorContext(organizationId, runtime.dependencies);
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    throw error;
  }
  if (!actor.capabilities.includes("imports.read")) return <main className="content"><h1>Access denied</h1><p>You need imports.read to view import jobs.</p></main>;
  return <MasterDataImports organizationId={organizationId} capabilities={actor.capabilities} />;
}
