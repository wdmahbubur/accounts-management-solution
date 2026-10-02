import {parseOrganizationId} from "@ams/contracts";import {CatalogItemsPage} from "../catalog-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function Page({params}:{params:Promise<{organizationId:string}>}){return <CatalogItemsPage organizationId={parseOrganizationId((await params).organizationId)}/>;}
