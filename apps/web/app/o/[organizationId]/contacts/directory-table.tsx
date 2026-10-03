import Link from "next/link";
import {DirectoryFilters} from "./directory-filters.tsx";
type Row={id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;is_active:boolean;outstanding:string;available_credit:string;advances:string;overdue:string};
type Page={items:Row[];next_cursor:string|null};
export function DirectoryTable({scope,base,search,status,userId,organizationId,page}:{scope:"customer"|"vendor";base:string;search:string;status:"active"|"inactive"|"overdue"|"all";userId:string;organizationId:string;page:Page}){
 const next=new URLSearchParams({status});if(search)next.set("search",search);if(page.next_cursor)next.set("after",page.next_cursor);
 return <section className="panel"><DirectoryFilters scope={scope} base={base} search={search} status={status} userId={userId} organizationId={organizationId}/>
 {page.items.length===0?<p>No {scope} contacts match these filters.</p>:<div className="table-scroll"><table><thead><tr><th>Name</th><th>Open {scope==="customer"?"receivables":"payables"} (BDT)</th><th>Overdue (BDT)</th><th>Available credits (BDT)</th><th>Advances (BDT)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{page.items.map(row=><tr key={row.id}><td><Link href={`${base}/${row.id}`}>{row.display_name}</Link><small>{row.email??row.phone??row.legal_name??""}</small></td><td>{row.outstanding}</td><td>{row.overdue}</td><td>{row.available_credit}</td><td>{row.advances}</td><td>{row.is_active?"Active":"Archived"}</td><td><Link href={`${base}/${row.id}`}>Open profile</Link></td></tr>)}</tbody></table></div>}
 {page.next_cursor&&<p><Link className="secondary" href={`${base}?${next.toString()}`}>Next page</Link></p>}</section>;
}
