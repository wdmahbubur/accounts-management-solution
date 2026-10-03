import {parseOrganizationId} from "@ams/contracts";import {ContactDirectoryPage} from "../../contacts/page-views.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function VendorsPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{search?:string|string[];status?:string|string[];after?:string|string[]}>}){const organizationId=parseOrganizationId((await params).organizationId);return <ContactDirectoryPage organizationId={organizationId} scope="vendor" searchParams={searchParams}/>;}
