import Link from "next/link";
import {parseOrganizationId} from "@ams/contracts";
import {CommandError} from "../../../../server/commands/errors.ts";
import {resolveActorContext} from "../../../../server/auth/resolve-actor.ts";
import {readContactDirectory,readContactProfile,type ContactScope} from "../../../../server/contacts/service.ts";
import {roleRuntime} from "../../../../server/roles/runtime.ts";
import {DirectoryTable} from "./directory-table.tsx";
import {ContactForm,type ContactRecord} from "./contact-form.tsx";
import {ContactProfile} from "./contact-profile.tsx";

type DirectoryQuery={search?:string|string[];status?:string|string[];after?:string|string[]};
export async function ContactDirectoryPage({organizationId,scope,searchParams}:{organizationId:string;scope:ContactScope;searchParams?:Promise<DirectoryQuery>}){
 const companyId=parseOrganizationId(organizationId);const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==companyId)throw CommandError.notFound();const actor=await resolveActorContext(companyId,runtime.dependencies);
 if(!actor.capabilities.includes(scope==="customer"?"sales.read":"purchases.read"))return <main className="content"><h1>Access denied</h1><p>You do not have permission to view this directory.</p></main>;
 const query=await searchParams,readOne=(value:string|string[]|undefined)=>Array.isArray(value)?null:value;
 const searchValue=readOne(query?.search),statusValue=readOne(query?.status)??"active",afterValue=readOne(query?.after);
 const repeated=Object.values(query??{}).some(Array.isArray),unknown=Object.keys(query??{}).some(key=>!["search","status","after"].includes(key));
 const validCursor=afterValue===undefined||afterValue===null||/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(afterValue);
 const validStatus=["active","inactive","overdue","all"].includes(statusValue);
 const validSearch=searchValue===undefined||searchValue===null||searchValue.length<=100;
 const base=`/o/${organizationId}/${scope==="customer"?"sales/customers":"purchases/vendors"}`;
 if(repeated||unknown||!validCursor||!validStatus||!validSearch)return <main className="content"><p className="eyebrow">{scope==="customer"?"Sales":"Purchasing"}</p><h1>{scope==="customer"?"Customers":"Suppliers"}</h1><p role="alert">These search filters are invalid. Reset them and try again.</p><Link className="secondary" href={base}>Reset filters</Link></main>;
 const search=searchValue?.trim()??"",status=statusValue as "active"|"inactive"|"overdue"|"all";
 let page:Awaited<ReturnType<typeof readContactDirectory>>;
 try{page=await readContactDirectory(runtime.client,actor,{scope,search:search||null,status,after:afterValue??null,limit:50});}
 catch(error){if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main className="content"><h1>Access denied</h1><p>You do not have permission to view this directory.</p></main>;throw error;}
 return <main className="content"><p className="eyebrow">{scope==="customer"?"Sales":"Purchasing"}</p><h1>{scope==="customer"?"Customers":"Suppliers"}</h1><p>Balances derive from dated, posted control items. Shared contacts keep receivables and payables separate.</p>{actor.capabilities.includes("contacts.write")&&<p><Link className="secondary" href={`${base}/new`}>New {scope}</Link></p>}<DirectoryTable scope={scope} base={base} search={search} status={status} page={page as {items:never[];next_cursor:string|null}}/></main>;
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
