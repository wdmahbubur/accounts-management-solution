import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppFrame } from "../../../components/shell/frame.tsx";
import { resolveActorContext } from "../../../server/auth/resolve-actor.ts";
import { listActiveMemberships } from "../../../server/companies/memberships.ts";
import { CommandError } from "../../../server/commands/errors.ts";
import { roleRuntime } from "../../../server/roles/runtime.ts";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function CompanyLayout({ params, children }: { params: Promise<{ organizationId: string }>; children: ReactNode }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let actor;
  try { actor = await resolveActorContext(organizationId, runtime.dependencies); }
  catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    throw error;
  }
  const companies = await listActiveMemberships(runtime.client);
  const company = companies.find((item) => item.organizationId === organizationId);
  if (!company) redirect("/companies?error=not_found");
  const { data: { user } } = await runtime.client.auth.getUser();
  if (!user) redirect("/auth/sign-in?next=/companies");
  // Only current-company summary enters the client tree, never the full directory.
  // Remount local UI state when a company-context nonce changes. Child pages and
  // commands must still perform their own current authorization; layouts persist.
  return <AppFrame key={`${organizationId}:${runtime.current.nonce}`} organizationId={organizationId}
    companyName={company.organizationName} companyStatus={company.organizationStatus}
    capabilities={actor.capabilities} email={user.email ?? "Verified account"}>{children}</AppFrame>;
}
