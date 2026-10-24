import { parseUuid } from '@ams/contracts';
import AdvancesPage from '../page.tsx';
export const dynamic='force-dynamic';export const revalidate=0;
export default async function AdvanceLifecycle({params,searchParams}:{params:Promise<{organizationId:string;advanceId:string}>;searchParams:Promise<{date?:string;tab?:string;mode?:string}>}){
  const p=await params,q=await searchParams;
  return AdvancesPage({params:Promise.resolve({organizationId:p.organizationId}),searchParams:Promise.resolve({...q,advance_id:parseUuid(p.advanceId)})});
}
