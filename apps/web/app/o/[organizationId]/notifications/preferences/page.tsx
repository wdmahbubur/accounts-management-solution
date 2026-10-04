import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { NotificationPreferences } from "./preferences-form.tsx";

export const dynamic="force-dynamic";export const revalidate=0;
type Preferences={email_approvals:boolean;email_invoice_reminders:boolean;email_bill_reminders:boolean};
function parsePreferences(value:unknown):Preferences{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid notification preferences.");const row=value as Record<string,unknown>;
  if(typeof row.email_approvals!=="boolean"||typeof row.email_invoice_reminders!=="boolean"||typeof row.email_bill_reminders!=="boolean")throw new Error("Invalid notification preferences.");
  return{email_approvals:row.email_approvals,email_invoice_reminders:row.email_invoice_reminders,email_bill_reminders:row.email_bill_reminders};}
export default async function NotificationPreferencesPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
  let capabilities:readonly string[]=[];let preferences:Preferences|undefined;let forbidden=false;
  try{const actor=await resolveActorContext(organizationId,runtime.dependencies);capabilities=actor.capabilities;const result=await runtime.client.rpc("read_notification_preferences",{p_organization_id:organizationId});
    if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();if(result.error.code==="P0002")redirect("/companies?error=not_found");throw new Error("Notification preferences could not be loaded.");}
    preferences=parsePreferences(result.data);
  }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else throw error;}
  if(forbidden)return <main><h1>Email preferences</h1><p role="alert">You cannot view these preferences.</p><Link href={`/o/${organizationId}/notifications`}>Back to notifications</Link></main>;
  return <main><p className="eyebrow">Workspace</p><h1>Email preferences</h1><p>Emails are off until you enable a category. Daily reminder events are queued once per company-local date when scheduled.</p>
    <NotificationPreferences organizationId={organizationId} initial={preferences!} capabilities={capabilities}/></main>;
}
