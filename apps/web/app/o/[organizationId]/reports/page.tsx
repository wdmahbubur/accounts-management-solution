import { parseOrganizationId } from "@ams/contracts";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveActorContext } from "../../../../server/auth/resolve-actor.ts";
import { CommandError } from "../../../../server/commands/errors.ts";
import { roleRuntime } from "../../../../server/roles/runtime.ts";

export const dynamic="force-dynamic";export const revalidate=0;
type Report={name:string;description:string;href:string;permission:string;dateMeaning:string};
export default async function ReportHubPage({params}:{params:Promise<{organizationId:string}>}){
 let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
 const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)redirect("/companies?error=context_mismatch");
 let capabilities:readonly string[];try{capabilities=(await resolveActorContext(organizationId,runtime.dependencies)).capabilities;}catch(error){if(error instanceof CommandError&&error.code==="UNAUTHENTICATED")redirect("/auth/sign-in?next=/companies");if(error instanceof CommandError&&error.code==="FORBIDDEN")return <main className="content"><h1>Access denied</h1><p>You do not have access to this company’s reports.</p></main>;throw error;}
 const groups:{title:string;reports:Report[]}[]=[
  {title:"Financial statements",reports:[{name:"Trial balance",description:"Account balances at a selected date, with optional movement totals.",href:`/o/${organizationId}/reports/trial-balance`,permission:"reports.read",dateMeaning:"As of date"}]},
  {title:"Ledger and activity",reports:[{name:"General ledger",description:"Posted account activity with source journal drilldown.",href:`/o/${organizationId}/accounting/general-ledger`,permission:"ledger.read",dateMeaning:"Date range"},{name:"Journal register",description:"Posted journal history and linked correction records.",href:`/o/${organizationId}/accounting/journals`,permission:"ledger.read",dateMeaning:"Date range"}]},
  {title:"Banking",reports:[{name:"Cash accounts and cashbooks",description:"Open a cash account to view its posted cashbook and closing balance.",href:`/o/${organizationId}/banking/accounts`,permission:"banking.read",dateMeaning:"Date range"}]}
 ];
 const available=groups.map(group=>({...group,reports:group.reports.filter(report=>capabilities.includes(report.permission))})).filter(group=>group.reports.length);
 if(!capabilities.some(value=>["reports.read","ledger.read","banking.read"].includes(value)))return <main className="content"><h1>Access denied</h1><p>You need a report-specific permission to view reports.</p></main>;
 return <main className="content"><p className="eyebrow">Company reports</p><h1>Reports</h1><p>Choose a report and its cutoff. Financial totals come from posted journals; each report identifies whether its date is a period range or an as-of date.</p>{available.map(group=><section className="panel" key={group.title}><h2>{group.title}</h2><div className="toolbar">{group.reports.map(report=><article className="panel" key={report.name}><h3><Link href={report.href}>{report.name}</Link></h3><p>{report.description}</p><p>Date: {report.dateMeaning} · Access: {report.permission}</p></article>)}</div></section>)}</main>;
}
