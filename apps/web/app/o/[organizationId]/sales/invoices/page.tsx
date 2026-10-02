import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readInvoiceRegister, type InvoiceTab } from "../../../../../server/documents/invoice-register.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";

export const dynamic="force-dynamic";export const revalidate=0;
const tabs:[InvoiceTab,string][]=[["all","All"],["drafts","Drafts"],["awaiting_approval","Awaiting approval"],["posted","Posted"]];
export default async function InvoiceRegisterPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{tab?:string;search?:string;after?:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const query=await searchParams;const tab=(tabs.some(([value])=>value===query.tab)?query.tab:"all") as InvoiceTab;
 const search=typeof query.search==="string"?query.search.trim().slice(0,100):"";
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);const page=await readInvoiceRegister(runtime.client,actor,{status:tab,search:search||null,after:query.after??null,limit:50});
  const makeHref=(nextTab:InvoiceTab,after?:string)=>{const p=new URLSearchParams();p.set("tab",nextTab);if(search)p.set("search",search);if(after)p.set("after",after);return`/o/${organizationId}/sales/invoices?${p.toString()}`;};
  return <main className="content"><p className="eyebrow">Sales</p><h1>Invoices</h1><p>Invoice status, settlement and delivery are tracked independently. Drafts have no ledger effect.</p>
   <div className="toolbar"><Link className="primary" href={`/o/${organizationId}/sales/invoices/new`}>Create invoice</Link><Link className="secondary" href={`/api/v1/organizations/${organizationId}/invoices/export?tab=${tab}${search?`&search=${encodeURIComponent(search)}`:""}`}>Export filtered invoices (CSV)</Link></div>
   <nav className="toolbar" aria-label="Invoice status">{tabs.map(([value,label])=><Link key={value} aria-current={tab===value?"page":undefined} className={tab===value?"primary":"secondary"} href={makeHref(value)}>{label}</Link>)}</nav>
   <form className="panel toolbar" action={`/o/${organizationId}/sales/invoices`} method="get"><input type="hidden" name="tab" value={tab}/><label>Search invoices<input type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, customer or reference"/></label><button type="submit">Search</button>{search&&<Link className="secondary" href={makeHref(tab)}>Clear</Link>}</form>
   <section className="panel"><h2>{tabs.find(([value])=>value===tab)?.[1]} invoices</h2>{page.items.length===0?<p>No invoices match these filters.</p>:<div className="table-scroll"><table><thead><tr><th>Number</th><th>Customer</th><th>Issue date</th><th>Due date</th><th>Total (BDT)</th><th>Residual (BDT)</th><th>Settlement</th><th>Delivery</th><th>Due status</th><th>Actions</th></tr></thead><tbody>{page.items.map(invoice=><tr key={invoice.id}><td><Link href={`/o/${organizationId}/accounting/documents/${invoice.id}`}>{invoice.documentNumber??"Draft"}</Link></td><td>{invoice.customerName}</td><td>{invoice.issueDate}</td><td>{invoice.dueDate??"—"}</td><td>{invoice.totalAmount}</td><td>{invoice.residualAmount??"—"}</td><td>{invoice.settlementStatus.replaceAll("_"," ")}</td><td>{invoice.deliveryStatus.replaceAll("_"," ")}</td><td>{invoice.overdue?"Overdue":"—"}</td><td><Link href={`/o/${organizationId}/accounting/documents/${invoice.id}`}>Open</Link> · <Link href={`/o/${organizationId}/sales/invoices/new?copy=${invoice.id}`}>Duplicate</Link></td></tr>)}</tbody></table></div>}
    {page.nextCursor&&<p><Link className="secondary" href={makeHref(tab,page.nextCursor)}>Next page</Link></p>}
   </section>
  </main>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main className="content"><h1>Access denied</h1><p>You need sales.read to view invoices.</p></main>;throw error;}
}
