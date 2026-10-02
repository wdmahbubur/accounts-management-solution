import { redirect } from "next/navigation";
export default async function NewRefundPage({params}:{params:Promise<{organizationId:string}>}){const {organizationId}=await params;redirect(`/o/${organizationId}/accounting/documents/new?type=customer_refund`);}
