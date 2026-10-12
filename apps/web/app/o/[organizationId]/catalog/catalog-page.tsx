import Link from "next/link";
import {parseOrganizationId} from "@ams/contracts";
import {CommandError} from "../../../../server/commands/errors.ts";
import {resolveActorContext} from "../../../../server/auth/resolve-actor.ts";
import {readServiceCatalog} from "../../../../server/catalog/service.ts";
import {roleRuntime} from "../../../../server/roles/runtime.ts";
import {CatalogManager,type CatalogData} from "./catalog-manager.tsx";
import styles from "../../../../components/finance/finance.module.css";
export async function CatalogItemsPage({organizationId}:{organizationId:string}){return <CatalogPage organizationId={organizationId} centers={false}/>;}
export async function CostCentersPage({organizationId}:{organizationId:string}){return <CatalogPage organizationId={organizationId} centers/>;}
async function CatalogPage({organizationId,centers}:{organizationId:string;centers:boolean}){const companyId=parseOrganizationId(organizationId);const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==companyId)throw CommandError.notFound();const actor=await resolveActorContext(companyId,runtime.dependencies);
 if(!actor.capabilities.includes("catalog.read"))return <main className="content"><h1>Access denied</h1><p>You cannot view catalogue settings.</p></main>;
 const raw=await readServiceCatalog(runtime.client,actor);const data={items:Array.isArray(raw.items)?raw.items as CatalogData["items"]:[],cost_centers:Array.isArray(raw.cost_centers)?raw.cost_centers as CatalogData["cost_centers"]:[],accounts:Array.isArray(raw.accounts)?raw.accounts as CatalogData["accounts"]:[],tax_codes:Array.isArray(raw.tax_codes)?raw.tax_codes as CatalogData["tax_codes"]:[]};
 return <main className="content"><header className={styles.pageHeader}><div><p className="eyebrow">Catalogue</p><h1>{centers?"Cost centers":"Items and services"}</h1><p>{centers?"Group transactions for management reports without creating separate books.":"Reusable descriptions, rates and account defaults for service and non-stock items."}</p></div></header>
   <nav className={styles.tabs} aria-label="Catalogue sections"><Link aria-current={!centers?"page":undefined} href={`/o/${organizationId}/catalog/items`}>Items</Link><Link aria-current={centers?"page":undefined} href={`/o/${organizationId}/catalog/cost-centers`}>Cost centers</Link></nav>
   <CatalogManager organizationId={organizationId} data={data} centers={centers} canWrite={actor.capabilities.includes("catalog.write")}/>
   {!centers&&<p className={styles.filterHint}>This catalogue does not track stock quantities, inventory valuation or cost of goods sold.</p>}
 </main>;
}
