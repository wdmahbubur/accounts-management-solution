import {parseOrganizationId,parseUuid} from "@ams/contracts";import {ContactProfilePage} from "../../../../contacts/page-views.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function EditVendorPage({params}:{params:Promise<{organizationId:string;contactId:string}>}){const p=await params;return <ContactProfilePage organizationId={parseOrganizationId(p.organizationId)} scope="vendor" contactId={parseUuid(p.contactId)} edit/>;}
