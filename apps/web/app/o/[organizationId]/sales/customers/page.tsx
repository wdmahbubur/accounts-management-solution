import {parseOrganizationId} from "@ams/contracts";import {ContactDirectoryPage} from "../../contacts/page-views.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function CustomersPage({params}:{params:Promise<{organizationId:string}>}){const organizationId=parseOrganizationId((await params).organizationId);return <ContactDirectoryPage organizationId={organizationId} scope="customer"/>;}
