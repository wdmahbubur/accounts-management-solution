import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readCompanySetup } from "../../../../../server/onboarding/setup.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { CompanySetupForm } from "./setup-form.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanySetupPage({ params }: { params: Promise<{ organizationId: string }> }) {
  let organizationId;
  try { organizationId = parseOrganizationId((await params).organizationId); }
  catch { redirect("/companies?error=not_found"); }
  const runtime = await roleRuntime();
  if (!runtime.current || runtime.current.organizationId !== organizationId) redirect("/companies?error=context_mismatch");
  let setup;
  try {
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    setup = await readCompanySetup(runtime.client, actor);
  } catch (error) {
    if (error instanceof CommandError && error.code === "UNAUTHENTICATED") redirect("/auth/sign-in?next=/companies");
    if (error instanceof CommandError && error.code === "NOT_FOUND") redirect("/companies?error=not_found");
    if (error instanceof CommandError && error.code === "FORBIDDEN") return <main className="content"><h1>Company setup</h1><p>An active company owner can finish the initial books setup.</p></main>;
    throw error;
  }
  return <CompanySetupForm setup={setup} nonce={runtime.current.nonce} />;
}
