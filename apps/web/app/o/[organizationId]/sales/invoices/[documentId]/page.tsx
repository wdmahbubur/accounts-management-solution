import { DocumentDetailPage } from "../../../accounting/documents/[documentId]/document-detail-page.tsx";
export const dynamic="force-dynamic";export const revalidate=0;
export default async function InvoiceDetailPage({params}:{params:Promise<{organizationId:string;documentId:string}>}){return DocumentDetailPage({params});}
