import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { readFinancialDocument } from "../../../../../server/documents/service.ts";
import { OpeningBalanceWizard } from "./opening-balance-wizard.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function OpeningBalancesPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{document?:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 let options:Record<string,unknown>;let initial:Parameters<typeof OpeningBalanceWizard>[0]["initial"];
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!["journal.write","documents.read","accounting.read"].every(capability=>actor.capabilities.includes(capability)))throw CommandError.forbidden();const result=await runtime.client.rpc("list_opening_cutover_options",{p_organization_id:organizationId});if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();throw new Error("Opening cutover options could not be loaded.");}if(!result.data||typeof result.data!=="object"||Array.isArray(result.data))throw new Error("Opening cutover options were malformed.");options=result.data as Record<string,unknown>;
 const requested=(await searchParams).document;if(requested){const documentId=parseUuid(requested);const document=await readFinancialDocument(runtime.client,actor,documentId);if(document.document_type!=="opening_balance"||document.state!=="draft")redirect(`/o/${organizationId}/accounting/documents/${documentId}`);
 const summary=await runtime.client.rpc("read_opening_cutover_summary",{p_organization_id:organizationId,p_document_id:documentId});if(summary.error)throw new Error("Opening evidence could not be loaded.");
 const balances:Record<string,{debit:string;credit:string}>={};const details:NonNullable<typeof initial>["details"]=[];
 const accounts=options.accounts as {id:string;control_kind:string|null}[];const parties=options.parties as {id:string}[];
 for(const [index,value] of (document.journal_rows as Record<string,unknown>[]).entries()){const account=accounts.find(a=>a.id===value.account_id);if(!account||value.cost_center_id||value.cash_flow_class)throw new Error("This opening draft includes an unavailable account or dimensions that the cutover workspace cannot safely edit.");
 if(account.control_kind){if(!parties.some(p=>p.id===value.party_id))throw new Error("An opening party is unavailable. Restore that party before editing this draft.");details.push({id:String(index),account_id:account.id,party_id:String(value.party_id),reference:String(value.open_item_reference??""),due_date:String(value.open_item_due_date??options.cutover_date),debit:String(value.debit),credit:String(value.credit)});}
 else {if(value.party_id||value.open_item_reference||value.open_item_due_date||balances[account.id])throw new Error("This opening draft contains detail that the cutover workspace cannot safely combine. Review the source before editing.");balances[account.id]={debit:String(value.debit),credit:String(value.credit)};}}
 initial={id:documentId,version:Number(document.version),balances,details,evidence:String((summary.data as Record<string,unknown>|null)?.evidence_reference??document.external_reference??"")};}

 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main className="content"><h1>Access denied</h1><p>You need permission to prepare journals and read accounting documents and cutover evidence to use this workspace.</p></main>;throw error;}
 const valid=typeof options.books_start_date==="string"&&typeof options.cutover_date==="string"&&typeof options.fiscal_year_start==="string"&&Array.isArray(options.accounts)&&Array.isArray(options.parties);
 if(!valid)throw new Error("Opening cutover options were incomplete.");
 return <OpeningBalanceWizard organizationId={organizationId} nonce={runtime.current.nonce} initial={initial} options={options as unknown as Parameters<typeof OpeningBalanceWizard>[0]["options"]}/>;
}
