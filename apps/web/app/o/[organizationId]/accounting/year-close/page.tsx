import {parseOrganizationId} from "@ams/contracts";
import Link from "next/link";
import {redirect} from "next/navigation";
import {resolveActorContext} from "../../../../../server/auth/resolve-actor.ts";
import {CommandError} from "../../../../../server/commands/errors.ts";
import {roleRuntime} from "../../../../../server/roles/runtime.ts";
import {YearCloseScreen} from "./screen.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
type Year={id:string;label:string;starts_on:string;ends_on:string;status:"open"|"closed";active_close:{run_id:string;document_id:string;created_at:string;snapshot:Record<string,unknown>}|null;history:{run_id:string;close_document_id:string;reopen_document_id:string|null;created_at:string;snapshot:Record<string,unknown>}[]};
export default async function YearClosePage({params}:{params:Promise<{organizationId:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 let years:Year[]=[],canClose=false,canReopen=false,forbidden=false,initialPreview:Record<string,unknown>|null=null;
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies),result=await runtime.client.rpc("list_year_close_workspace",{p_organization_id:organizationId});
  if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Year-close workspace could not be loaded.");}
  if(!Array.isArray(result.data))throw new Error("Invalid year-close workspace.");years=result.data as Year[];canClose=actor.capabilities.includes("periods.lock");canReopen=actor.capabilities.includes("periods.reopen");
  if(years[0]){const preview=await runtime.client.rpc("read_year_close_preview",{p_organization_id:organizationId,p_fiscal_year_id:years[0].id});if(preview.error)throw new Error("Year-close preview could not be loaded.");initialPreview=preview.data as Record<string,unknown>;}
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else throw error;}
 if(forbidden)return <main className="content"><h1>Access denied</h1><p>You need accounting.read to review year close.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
 return <YearCloseScreen organizationId={organizationId} years={years} canClose={canClose} canReopen={canReopen} initialPreview={initialPreview}/>;
}
