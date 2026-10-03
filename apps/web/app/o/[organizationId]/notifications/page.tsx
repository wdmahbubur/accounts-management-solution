import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";
import { NotificationList } from "./notification-list.tsx";

export const dynamic="force-dynamic";
export const revalidate=0;
type Item={kind:"approval"|"delivery_failure"|"export_failure"|"invoice_due"|"bill_due";id:string;title:string;detail:string;occurred_at:string;is_read:boolean;document_id:string|null};
function parseItems(raw:unknown):Item[]{
  if(!Array.isArray(raw)||raw.length>100)throw new Error("Invalid notification list response.");
  return raw.map((entry)=>{if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error("Invalid notification entry.");
    const row=entry as Record<string,unknown>;
    if(!["approval","delivery_failure","export_failure","invoice_due","bill_due"].includes(String(row.kind))||typeof row.id!=="string"||typeof row.title!=="string"||
      typeof row.detail!=="string"||typeof row.occurred_at!=="string"||typeof row.is_read!=="boolean"||
      !(row.document_id===null||typeof row.document_id==="string"))throw new Error("Invalid notification entry.");
    return row as Item;
  });
}
export default async function NotificationsPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
  let items:Item[]=[];let forbidden=false;
  try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const result=await runtime.client.rpc("list_notification_center",{p_organization_id:organizationId,p_limit:50});
    if(result.error){if(result.error.code==="42501")throw CommandError.forbidden();if(result.error.code==="28000")throw CommandError.unauthenticated();if(result.error.code==="P0002")throw CommandError.notFound();throw new Error("Notifications could not be loaded.");}
    if(actor.organizationId!==organizationId)throw CommandError.notFound();items=parseItems(result.data);
  }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;
    else if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");else throw error;}
  if(forbidden)return <main><h1>Notifications</h1><p role="alert">You do not have permission to view notifications.</p><Link href={`/o/${organizationId}`}>Back to company</Link></main>;
  return <main><p className="eyebrow">Workspace</p><h1>Notifications</h1><p>Approvals and failed delivery or export activity you are authorized to view.</p>
    <p><Link href={`/o/${organizationId}/notifications/preferences`}>Email preferences</Link></p>
    <NotificationList organizationId={organizationId} items={items}/></main>;
}
