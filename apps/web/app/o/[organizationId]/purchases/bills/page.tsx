import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readBillRegister, type BillTab } from "../../../../../server/documents/bill-register.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import { registerHref } from "../../../../../lib/register-navigation.ts";

export const dynamic="force-dynamic";export const revalidate=0;
const tabs:[BillTab,string][]=[["all","All"],["drafts","Drafts"],["awaiting_approval","Awaiting approval"],["posted","Posted"]];
export default async function BillRegisterPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{tab?:string;search?:string;after?:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const query=await searchParams;const tab=(tabs.some(([value])=>value===query.tab)?query.tab:"all") as BillTab;const search=typeof query.search==="string"?query.search.trim().slice(0,100):"";
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 let page:Awaited<ReturnType<typeof readBillRegister>>|undefined;let forbidden=false;let failure:unknown;
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);page=await readBillRegister(runtime.client,actor,{status:tab,search:search||null,after:query.after??null,limit:50});}
 catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")forbidden=true;else failure=error;}
 if(forbidden)return <main className="content"><h1>Access denied</h1><p>You need purchases.read to view bills.</p></main>;if(failure)throw failure;if(!page)throw new Error("Bill register response was empty.");
 const base=`/o/${organizationId}/purchases/bills`;
 const href=(next:BillTab,after?:string)=>registerHref(base,{tab:next,search,after});
 return <main className="content"><p className="eyebrow">Purchases</p><h1>Supplier bills</h1><p>Track vendor liabilities, invoice references, duplicate warnings and payments. Saving a draft has no ledger effect.</p>
  <div className="toolbar"><Link className="primary" href={`/o/${organizationId}/purchases/bills/new`}>Create bill</Link></div>
  <nav className="toolbar" aria-label="Bill status">{tabs.map(([value,label])=><Link key={value} aria-current={tab===value?"page":undefined} className={tab===value?"primary":"secondary"} href={href(value)}>{label}</Link>)}</nav>
  <form key={JSON.stringify([tab,search])} className="panel toolbar" action={base} method="get"><input type="hidden" name="tab" value={tab}/><label>Search bills<input type="search" name="search" maxLength={100} defaultValue={search} placeholder="Number, vendor or invoice reference"/></label><button type="submit">Search</button>{search&&<Link className="secondary" href={registerHref(base,{tab})}>Clear</Link>}</form>
  <section className="panel"><h2>{tabs.find(([value])=>value===tab)?.[1]} bills</h2>{page.items.length===0?<p>No bills match these filters.</p>:<div className="table-scroll"><table><thead><tr><th>Number</th><th>Vendor</th><th>Vendor invoice</th><th>Bill date</th><th>Due date</th><th>Total (BDT)</th><th>AP residual</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.items.map(bill=><tr key={bill.id}><td><Link href={`/o/${organizationId}/purchases/bills/${bill.id}`}>{bill.documentNumber??"Draft"}</Link></td><td>{bill.vendorName}</td><td>{bill.invoiceReference??"—"}{bill.duplicateReference&&<strong role="status"> · Possible duplicate</strong>}</td><td>{bill.issueDate}</td><td>{bill.dueDate??"—"}</td><td>{bill.totalAmount}</td><td>{bill.residualAmount??"—"}</td><td>{bill.settlementStatus.replaceAll("_"," ")}</td><td><Link href={`/o/${organizationId}/purchases/bills/${bill.id}`}>Open</Link> · <Link href={`/o/${organizationId}/purchases/bills/new?copy=${bill.id}`}>Duplicate</Link></td></tr>)}</tbody></table></div>}{page.nextCursor&&<p><Link className="secondary" href={href(tab,page.nextCursor)}>Next page</Link></p>}</section>
 </main>;
}
