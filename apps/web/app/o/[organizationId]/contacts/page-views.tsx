import Link from "next/link";
import {parseOrganizationId} from "@ams/contracts";
import {CommandError} from "../../../../server/commands/errors.ts";
import {resolveActorContext} from "../../../../server/auth/resolve-actor.ts";
import {readContactDirectory,readContactProfile,type ContactScope} from "../../../../server/contacts/service.ts";
import {roleRuntime} from "../../../../server/roles/runtime.ts";
import {DirectoryTable} from "./directory-table.tsx";
import {ContactForm,type ContactRecord} from "./contact-form.tsx";
import {ContactProfile} from "./contact-profile.tsx";

export async function ContactDirectoryPage({organizationId,scope}:{organizationId:string;scope:ContactScope}){
 const companyId=parseOrganizationId(organizationId);const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==companyId)throw CommandError.notFound();const actor=await resolveActorContext(companyId,runtime.dependencies);
 if(!actor.capabilities.includes(scope==="customer"?"sales.read":"purchases.read"))return <main className="content"><h1>Access denied</h1><p>You do not have permission to view this directory.</p></main>;
 const page=await readContactDirectory(runtime.client,actor,{scope,search:null,status:"active",after:null,limit:50});const base=`/o/${organizationId}/${scope==="customer"?"sales/customers":"purchases/vendors"}`;
 return <main className="content"><p className="eyebrow">{scope==="customer"?"Sales":"Purchasing"}</p><h1>{scope==="customer"?"Customers":"Suppliers"}</h1><p>Balances derive from dated, posted control items. Shared contacts keep receivables and payables separate.</p>{actor.capabilities.includes("contacts.write")&&<p><Link className="secondary" href={`${base}/new`}>New {scope}</Link></p>}<DirectoryTable organizationId={organizationId} scope={scope} initial={page as {items:never[];next_cursor:string|null}}/></main>;
}
export async function NewContactPage({organizationId,scope}:{organizationId:string;scope:ContactScope}){
 const companyId=parseOrganizationId(organizationId);const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==companyId)throw CommandError.notFound();const actor=await resolveActorContext(companyId,runtime.dependencies);if(!actor.capabilities.includes("contacts.write"))return <main className="content"><h1>Access denied</h1><p>You cannot create or edit contacts.</p></main>;
 return <main className="content"><p className="eyebrow">{scope==="customer"?"Sales":"Purchasing"}</p><h1>New {scope}</h1><ContactForm organizationId={organizationId} scope={scope}/></main>;
}
export async function ContactProfilePage({organizationId,scope,contactId,edit=false}:{organizationId:string;scope:ContactScope;contactId:string;edit?:boolean}){
 const companyId=parseOrganizationId(organizationId);const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==companyId)throw CommandError.notFound();const actor=await resolveActorContext(companyId,runtime.dependencies);
 if(edit&&!actor.capabilities.includes("contacts.write"))return <main className="content"><h1>Access denied</h1><p>You cannot edit contacts.</p></main>;
 if(!actor.capabilities.includes(scope==="customer"?"sales.read":"purchases.read"))return <main className="content"><h1>Access denied</h1><p>You do not have permission to view this profile.</p></main>;
 const profile=await readContactProfile(runtime.client,actor,scope,contactId);
 if(edit){const raw=profile.contact as Record<string,unknown>;const initial={id:String(raw.id),display_name:String(raw.display_name),legal_name:raw.legal_name===null?null:String(raw.legal_name),is_customer:Boolean(raw.is_customer),is_vendor:Boolean(raw.is_vendor),email:raw.email===null?null:String(raw.email),phone:raw.phone===null?null:String(raw.phone),billing_address:raw.billing_address as Record<string,unknown>,tax_identifiers:raw.tax_identifiers as Record<string,unknown>,payment_terms_days:Number(raw.payment_terms_days),credit_limit:raw.credit_limit===null?null:String(raw.credit_limit),external_key:raw.external_key===null?null:String(raw.external_key),is_active:Boolean(raw.is_active),row_version:Number(raw.row_version)} satisfies ContactRecord;
  return <main className="content"><p className="eyebrow">Edit {scope}</p><h1>{initial.display_name}</h1><ContactForm organizationId={organizationId} scope={scope} initial={initial}/></main>;}
 const base=`/o/${organizationId}/${scope==="customer"?"sales/customers":"purchases/vendors"}`;
 return <main className="content"><p><Link href={base}>← {scope==="customer"?"Customers":"Suppliers"}</Link></p><ContactProfile organizationId={organizationId} scope={scope} profile={profile as never} canEdit={actor.capabilities.includes("contacts.write")} canWrite={actor.capabilities.includes(scope==="customer"?"sales.write":"purchases.write")}/></main>;
}
