import { listOwnImports, stageMasterDataImport } from "../../../../../../server/imports/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return listOwnImports((await context.params).organizationId);
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return stageMasterDataImport(request, (await context.params).organizationId);
}
