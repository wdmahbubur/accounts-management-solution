import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { readTaxCatalog } from "../../../../../server/taxes/service.ts";
import type { TaxCatalog } from "../../../../../server/taxes/contracts.ts";
import { TaxSettings } from "./tax-settings.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function TaxSettingsPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); } catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let catalog: TaxCatalog = { codes: [], accounts: [] }; let forbidden = false; let canManage = false;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    catalog = await readTaxCatalog(runtime.client, actor); canManage = actor.capabilities.includes("tax.manage");
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") forbidden = true; else throw error;
  }
  if (forbidden) return <main><p className="eyebrow">Company settings</p><h1>Access denied</h1><p>You need tax.read to view tax configuration.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  return <TaxSettings organizationId={organizationId} nonce={runtime.current.nonce} catalog={catalog} canManage={canManage} />;
}
