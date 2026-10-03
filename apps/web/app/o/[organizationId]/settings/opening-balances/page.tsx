import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { OpeningBalanceWizard } from "./opening-balance-wizard.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function OpeningBalancesPage({params}:{params:Promise<{organizationId:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 let options:Record<string,unknown>;
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("journal.write"))throw CommandError.forbidden();const result=await runtime.client.rpc("list_opening_cutover_options",{p_organization_id:organizationId});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Opening cutover options could not be loaded.");}if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw new Error("Opening cutover options were malformed.");options=result.data as Record<string,unknown>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main className="content"><h1>Access denied</h1><p>You need journal.write to prepare company opening balances.</p></main>;throw error;}
 const valid=typeof options.books_start_date==="string"&&typeof options.cutover_date==="string"&&typeof options.fiscal_year_start==="string"&&Array.isArray(options.accounts)&&Array.isArray(options.parties);
 if(!valid)throw new Error("Opening cutover options were incomplete.");
 return <OpeningBalanceWizard organizationId={organizationId} nonce={runtime.current.nonce} options={options as unknown as Parameters<typeof OpeningBalanceWizard>[0]["options"]}/>;
}
