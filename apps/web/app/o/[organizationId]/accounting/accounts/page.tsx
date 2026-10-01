import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readAccountCatalog } from "../../../../../server/accounts/service.ts";
import type { AccountCatalog } from "../../../../../server/accounts/contracts.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { AccountManager } from "./screen.tsx";

export const dynamic="force-dynamic";
export const revalidate=0;
export default async function ChartOfAccountsPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
  let catalog:AccountCatalog={accounts:[],mappings:[]};let canManage=false;let forbidden=false;
  try{const actor=await resolveActorContext(organizationId,runtime.dependencies);catalog=await readAccountCatalog(runtime.client,actor);
    canManage=actor.capabilities.includes("accounting.read")&&actor.capabilities.includes("journal.write");
  }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");
    if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");
    if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else throw error;}
  if(forbidden)return <main><p className="eyebrow">Accounting</p><h1>Access denied</h1>
    <p>You need accounting.read to view this company chart.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  return <AccountManager organizationId={organizationId} nonce={runtime.current.nonce} accounts={catalog.accounts} mappings={catalog.mappings} canManage={canManage}/>;
}
