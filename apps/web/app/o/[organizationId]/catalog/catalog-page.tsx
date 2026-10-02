import Link from "next/link";
import {CommandError} from "../../../../server/commands/errors.ts";
import {resolveActorContext} from "../../../../server/auth/resolve-actor.ts";
import {readServiceCatalog} from "../../../../server/catalog/service.ts";
import {roleRuntime} from "../../../../server/roles/runtime.ts";
import {CatalogManager,type CatalogData} from "./catalog-manager.tsx";
export async function CatalogItemsPage({organizationId}:{organizationId:string}){return <CatalogPage organizationId={organizationId} centers={false}/>;}
export async function CostCentersPage({organizationId}:{organizationId:string}){return <CatalogPage organizationId={organizationId} centers/>;}
async function CatalogPage({organizationId,centers}:{organizationId:string;centers:boolean}){const runtime=await roleRuntime();if(!runtime.current||runtime.current.organizationId!==organizationId)throw CommandError.notFound();const actor=await resolveActorContext(organizationId,runtime.dependencies);
 if(!actor.capabilities.includes("catalog.read"))return <main className="content"><h1>Access denied</h1><p>You cannot view catalogue settings.</p></main>;
 const raw=await readServiceCatalog(runtime.client,actor);const data={items:Array.isArray(raw.items)?raw.items as CatalogData["items"]:[],cost_centers:Array.isArray(raw.cost_centers)?raw.cost_centers as CatalogData["cost_centers"]:[],accounts:Array.isArray(raw.accounts)?raw.accounts as CatalogData["accounts"]:[],tax_codes:Array.isArray(raw.tax_codes)?raw.tax_codes as CatalogData["tax_codes"]:[]};
 return <main className="content"><p className="eyebrow">Master data · BDT service/non-stock scope</p><h1>{centers?"Cost centers":"Service and non-stock catalogue"}</h1><p>Catalogue defaults are copied into drafts; final line values remain editable and are checked again before posting. Inventory quantity, COGS costing and stock valuation are not part of this catalogue.</p><nav className="toolbar" aria-label="Catalogue sections"><Link className={!centers?"secondary":""} href={`/o/${organizationId}/catalog/items`}>Items</Link><Link className={centers?"secondary":""} href={`/o/${organizationId}/catalog/cost-centers`}>Cost centers</Link></nav><CatalogManager organizationId={organizationId} data={data} centers={centers} canWrite={actor.capabilities.includes("catalog.write")}/></main>;
}
