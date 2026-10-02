import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { roleRuntime } from "../../../../../../../server/roles/runtime.ts";

const headers = { "Cache-Control": "private, no-store, max-age=0", "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": "attachment; filename=contact-import-errors.csv", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u0020]*[=+@]/.test(text) || /^[\s\u0000-\u0020]*-/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export async function GET(_request: Request, context: { params: Promise<{ organizationId: string; importId: string }> }) {
  try {
    const params = await context.params; const organizationId = parseOrganizationId(params.organizationId); const importId = parseUuid(params.importId);
    const runtime = await roleRuntime(); const result = await runtime.client.rpc("read_contact_import", { p_organization_id: organizationId, p_import_job_id: importId });
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const job = result.data[0] as { rows?: Array<{ row_no: number; input_data: Record<string, unknown>; errors: string[]; status: string }> };
    const failed = (job.rows ?? []).filter((row) => row.errors?.length);
    const lines: unknown[][] = [["CSV row", "Display name", "Email", "Status", "Errors"],
      ...failed.map((row) => [row.row_no, row.input_data?.display_name, row.input_data?.email, row.status, row.errors.join("; ")])];
    const csv = `\uFEFF${lines.map((line) => line.map(cell).join(",")).join("\r\n")}\r\n`;
    return new Response(csv, { status: 200, headers });
  } catch { return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
}
