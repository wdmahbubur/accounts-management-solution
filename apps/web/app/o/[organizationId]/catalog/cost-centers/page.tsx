import {parseOrganizationId} from "@ams/contracts";import {CostCentersPage} from "../catalog-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function Page({params}:{params:Promise<{organizationId:string}>}){return <CostCentersPage organizationId={parseOrganizationId((await params).organizationId)}/>;}
