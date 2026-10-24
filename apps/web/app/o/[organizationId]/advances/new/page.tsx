import { parseOrganizationId } from '@ams/contracts';
import { redirect } from 'next/navigation';
export default async function NewAdvance({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{tab?:string}>}){
  const org=parseOrganizationId((await params).organizationId),tab=(await searchParams).tab;
  redirect(`/o/${org}/accounting/documents/new?type=${tab==='vendor'?'vendor_advance':'customer_advance'}`);
}
