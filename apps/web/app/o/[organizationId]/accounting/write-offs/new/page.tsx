import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { WriteOffForm } from "./write-off-form.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewWriteOffPage({params}:{params:Promise<{organizationId:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("dues.adjust"))throw CommandError.forbidden();
  const today=new Date().toISOString().slice(0,10);const r=await runtime.client.rpc("list_write_off_options",{p_organization_id:organizationId,p_as_of:today});if(r.error)throw new Error("Write-off options could not be loaded.");
  if(!r.data||typeof r.data!=="object"||Array.isArray(r.data))throw new Error("Invalid write-off options.");const value=r.data as Record<string,unknown>;
  const receivables=Array.isArray(value.receivables)?value.receivables as {id:string;party_name:string;reference:string;issue_date:string;available_amount:string}[]:[];
  const accounts=Array.isArray(value.expense_accounts)?value.expense_accounts as {id:string;code:string;name:string}[]:[];
  return <main className="content"><p className="eyebrow">Receivables</p><h1>Write off a bad debt</h1><p>Creates a reviewed expense debit and AR credit, then settles the new AR credit against the selected receivable. No tax reversal is generated.</p>
   <WriteOffForm organizationId={organizationId} today={today} receivables={receivables} accounts={accounts}/></main>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main><h1>Access denied</h1><p>You need the controlled adjustment capability.</p></main>;throw error;}
}
