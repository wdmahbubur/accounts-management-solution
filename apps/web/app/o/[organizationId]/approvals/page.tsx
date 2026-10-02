import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { readApprovalInbox } from "../../../../server/approvals/inbox-service.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { ApprovalInbox } from "./approval-inbox.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function ApprovalInboxPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
  try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const rows=await readApprovalInbox(runtime.client,actor,"pending");
    return <ApprovalInbox organizationId={organizationId} canDecide={actor.capabilities.includes("approvals.decide")} initialRows={rows}/>;
  }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");
    if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main><h1>Approval inbox</h1><p role="alert">You do not have permission to view approval requests.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
    if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");throw error;}
}
