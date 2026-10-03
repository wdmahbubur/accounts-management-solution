import { AgingReport } from "../aging-report.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function ReceivablesPage({params,searchParams}:{params:Promise<{organizationId:string}>;searchParams:Promise<{as_of?:string}>}){return AgingReport({params,searchParams,control:"ar"});}
