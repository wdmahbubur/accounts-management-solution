import { redirect } from "next/navigation";
export default async function RefundDetailPage({params}:{params:Promise<{organizationId:string;refundId:string}>}){const {organizationId,refundId}=await params;redirect(`/o/${organizationId}/accounting/documents/${refundId}`);}
