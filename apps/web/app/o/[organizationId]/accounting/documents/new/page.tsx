import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../../server/commands/errors.ts";
import { sourceTypes, type SourceType } from "../../../../../../server/documents/contracts.ts";
import { readDraftOptions } from "../../../../../../server/documents/service.ts";
import { roleRuntime } from "../../../../../../server/roles/runtime.ts";
import { DraftEditor, type DraftOptions } from "../draft-editor.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewDraftPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{type?:string;party_id?:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const query=await searchParams;const requested=query.type; if(!requested||(sourceTypes as readonly string[]).includes(requested)===false)redirect(`/o/${organizationId}/accounting/documents`);
 const documentType=requested as SourceType;const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const today=new Date().toISOString().slice(0,10);const raw=await readDraftOptions(runtime.client,actor,documentType,today);
  const options={accounts:Array.isArray(raw.accounts)?raw.accounts as DraftOptions["accounts"]:[],parties:Array.isArray(raw.parties)?raw.parties as DraftOptions["parties"]:[],cash_accounts:Array.isArray(raw.cash_accounts)?raw.cash_accounts as DraftOptions["cash_accounts"]:[],rounding_accounts:Array.isArray(raw.rounding_accounts)?raw.rounding_accounts as DraftOptions["rounding_accounts"]:[],tax_codes:Array.isArray(raw.tax_codes)?raw.tax_codes as DraftOptions["tax_codes"]:[]};
  const selectedParty=query.party_id&&options.parties.some(p=>p.id===query.party_id)?query.party_id:null;
  return <DraftEditor organizationId={organizationId} nonce={runtime.current.nonce} documentType={documentType} options={options} initial={selectedParty?{party_id:selectedParty}:undefined}/>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main><h1>Access denied</h1><p>You do not have permission to create this source type.</p></main>;throw error;}
}
