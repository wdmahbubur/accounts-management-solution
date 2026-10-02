import {parseOrganizationId} from "@ams/contracts";import {NewContactPage} from "../../../contacts/page-views.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function NewCustomerPage({params}:{params:Promise<{organizationId:string}>}){const organizationId=parseOrganizationId((await params).organizationId);return <NewContactPage organizationId={organizationId} scope="customer"/>;}
