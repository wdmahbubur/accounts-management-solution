import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../../server/commands/errors.ts";
import { readDocumentDirectory } from "../../../../../server/documents/directory.ts";
import { roleRuntime } from "../../../../../server/roles/runtime.ts";
import styles from "./documents.module.css";

export const dynamic="force-dynamic";export const revalidate=0;
export default async function DocumentDirectoryPage({params}:{params:Promise<{organizationId:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 try{const actor=await resolveActorContext(organizationId,runtime.dependencies);if(!actor.capabilities.includes("documents.read"))throw CommandError.forbidden();const rows=await readDocumentDirectory(runtime.client,organizationId);
  return <main className={styles.main}><p className="eyebrow">Finance workspace</p><h1>Financial documents</h1><p className={styles.hint}>Drafts are saved without ledger effect. Posting, settlement and delivery stay separate actions.</p>
   <section className={`panel ${styles.panel}`}><h2>Create a draft</h2><div className={styles.toolbar}>{[["invoice","Invoice"],["customer_credit","Customer credit"],["bill","Supplier bill"],["vendor_credit","Supplier credit"],["paid_expense","Paid expense"],["receipt","Receipt"],["vendor_payment","Supplier payment"],["customer_refund","Customer refund"],["vendor_refund","Supplier refund"],["customer_advance","Customer advance"],["vendor_advance","Supplier advance"],["transfer","Transfer"],["manual_journal","Manual journal"],["controlled_adjustment","Controlled adjustment"],["opening_balance","Opening balance"]].map(([type,label])=><Link key={type} className="secondary" href={`/o/${organizationId}/accounting/documents/new?type=${type}`}>New {label}</Link>)}</div></section>
   <section className={`panel ${styles.panel}`}><h2>Recent sources</h2>{rows.length===0?<p>No documents yet.</p>:<div className={styles.grid}><table><thead><tr><th>Number</th><th>Type</th><th>Accounting date</th><th>State</th><th>Total (BDT)</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id}><td><Link href={`/o/${organizationId}/accounting/documents/${row.id}`}>{row.documentNumber??"Draft"}</Link></td><td>{row.documentType.replaceAll("_"," ")}</td><td>{row.accountingDate}</td><td>{row.state}</td><td>{row.totalAmount}</td></tr>)}</tbody></table></div>}</section>
  </main>;
 }catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="NOT_FOUND")redirect("/companies?error=not_found");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main><h1>Access denied</h1><p>You need documents.read to view financial documents.</p></main>;throw error;}
}
