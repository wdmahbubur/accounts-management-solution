import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readApprovalPolicyCatalog } from "../../../../../server/approvals/policy-service.ts";
import type { ApprovalPolicyCatalog } from "../../../../../server/approvals/policy-contracts.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { ApprovalSettings } from "./approval-settings.tsx";

export const dynamic="force-dynamic";
export const revalidate=0;
export default async function ApprovalSettingsPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
  let catalog:ApprovalPolicyCatalog={policies:[],eligibleRoles:[]};let forbidden=false;
  try{const actor=await resolveActorContext(organizationId,runtime.dependencies);catalog=await readApprovalPolicyCatalog(runtime.client,actor);}
  catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");
    if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");
    if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else throw error;}
  if(forbidden)return <main><p className="eyebrow">Company settings</p><h1>Access denied</h1><p>Only an active company owner can configure approval policies.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  return <ApprovalSettings organizationId={organizationId} nonce={runtime.current.nonce} catalog={catalog}/>;
}
