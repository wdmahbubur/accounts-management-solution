import {CompanyCurrency} from '../../../../components/finance/company-currency.tsx';
import Link from "next/link";
import {DirectoryFilters} from "./directory-filters.tsx";
import {formatContactMoney} from "../../../../lib/contact-details.ts";
import styles from "../../../../components/finance/finance.module.css";
type Row={id:string;display_name:string;legal_name:string|null;email:string|null;phone:string|null;is_active:boolean;outstanding:string;available_credit:string;advances:string;overdue:string};
type Page={items:Row[];next_cursor:string|null};
export function DirectoryTable({scope,base,search,status,userId,organizationId,page}:{scope:"customer"|"vendor";base:string;search:string;status:"active"|"inactive"|"overdue"|"all";userId:string;organizationId:string;page:Page}){
 const next=new URLSearchParams({status});if(search)next.set("search",search);if(page.next_cursor)next.set("after",page.next_cursor);
 const label=scope==="customer"?"Customers":"Suppliers";
 const amount=(value:string)=>formatContactMoney(value)??"Unavailable";
 return <section className={`panel ${styles.register}`}><DirectoryFilters scope={scope} base={base} search={search} status={status} userId={userId} organizationId={organizationId}/>
   <div className={styles.listHeading}><h2>{label}</h2><p>Amounts in <CompanyCurrency /></p></div>
   {page.items.length===0?<p className={styles.empty}>No {label.toLowerCase()} match these filters.</p>:<div className={`table-scroll ${styles.scroll}`} tabIndex={0} role="region" aria-label={`${label} and balances`}><table>
     <thead><tr><th scope="col">Name</th><th scope="col" className={styles.amount}>Open {scope==="customer"?"receivables":"payables"}</th><th scope="col" className={styles.amount}>Overdue</th><th scope="col" className={styles.amount}>Available credits</th><th scope="col" className={styles.amount}>Advances</th><th scope="col">Status</th></tr></thead>
     <tbody>{page.items.map(row=>{const detail=row.email||row.phone||row.legal_name;return <tr key={row.id}>
       <th scope="row"><Link href={`${base}/${row.id}`}>{row.display_name}</Link>{detail&&<span className={styles.meta}>{detail}</span>}</th>
       <td className={styles.amount}>{amount(row.outstanding)}</td><td className={styles.amount}>{amount(row.overdue)}</td><td className={styles.amount}>{amount(row.available_credit)}</td><td className={styles.amount}>{amount(row.advances)}</td><td><span className={styles.badge}>{row.is_active?"Active":"Archived"}</span></td>
     </tr>;})}</tbody>
   </table></div>}
   {page.next_cursor&&<p className={styles.pagination}><Link className="secondary" href={`${base}?${next.toString()}`}>Next page</Link></p>}
 </section>;
}
