import { parseOrganizationId } from "@ams/contracts";
import { redirect } from "next/navigation";

export default async function NewTransferPage({params}:{params:Promise<{organizationId:string}>}){
  let organizationId;try{organizationId=parseOrganizationId((await params).organizationId);}catch{redirect("/companies?error=not_found");}
  redirect(`/o/${organizationId}/accounting/documents/new?type=transfer`);
}
