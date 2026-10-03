import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { StatementImport } from "./statement-import.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StatementImportPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let accounts: Record<string, unknown>[] = [];
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("banking.write")) throw CommandError.forbidden();
    const result = await runtime.client.rpc("read_cash_accounts", { p_organization_id: organizationId });
    if (result.error || !Array.isArray(result.data)) throw new Error("Cash accounts could not be loaded.");
    accounts = result.data.map((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid account row.");
      const row = value as Record<string, unknown>; parseUuid(row.id);
      if (typeof row.name !== "string" || typeof row.kind !== "string" || row.is_active !== true) throw new Error("Invalid account row.");
      return { id: row.id, name: row.name, kind: row.kind };
    });
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Access denied</h1><p>You need banking.write to import statements.</p></main>;
    throw error;
  }
  return <StatementImport organizationId={organizationId} accounts={accounts}/>;
}
