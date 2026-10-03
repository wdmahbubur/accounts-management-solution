import { parseMutationHeaders, parseOrganizationId, parseUuid } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId, hashCanonicalRequest } from "../commands/request-context.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { record } from "../roles/contracts.ts";

const noStore = { "Cache-Control": "private, no-store" };
const dateOk = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const types = ["profit_and_loss", "balance_sheet", "customer_statement", "vendor_statement"] as const;
type ReportType = typeof types[number];
const formats = ["csv", "pdf", "xlsx"] as const;
type ExportFormat = typeof formats[number];

export async function requestReportExport(request: Request, rawOrganizationId: string) {
  const requestFallback = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Expected JSON." }); }
    const body = record(raw);
    if (!types.includes(body.export_type as ReportType)) throw CommandError.validation({ export_type: "Choose a supported report." });
    const exportType = body.export_type as ReportType;
    const format = body.format === undefined ? "csv" : body.format;
    if (!formats.includes(format as ExportFormat)) throw CommandError.validation({ format: "Choose CSV, PDF or XLSX." });
    const allowed = exportType === "profit_and_loss" ? ["export_type", "format", "from", "to", "cost_center", "comparison_from", "comparison_to"] :
      exportType === "balance_sheet" ? ["export_type", "format", "as_of", "comparison_as_of"] :
      ["export_type", "format", "party_id", "from", "to"];
    if (Object.keys(body).some((key) => !allowed.includes(key))) throw CommandError.validation({ body: "Unexpected report filter." });
    let parameters: Record<string, unknown>;
    if (exportType === "profit_and_loss") {
      if (!dateOk(body.from) || !dateOk(body.to) || body.from > body.to ||
        ((body.comparison_from === undefined) !== (body.comparison_to === undefined)) ||
        (body.comparison_from !== undefined && (!dateOk(body.comparison_from) || !dateOk(body.comparison_to) ||
          !(body.to < body.comparison_from || body.comparison_to < body.from)))) {
        throw CommandError.validation({ period: "Provide valid, non-overlapping report periods." });
      }
      parameters = { from: body.from, to: body.to,
        ...(body.cost_center ? { cost_center: parseUuid(String(body.cost_center), "cost_center") } : {}),
        ...(body.comparison_from !== undefined ? { comparison_from: body.comparison_from, comparison_to: body.comparison_to } : {}) };
    } else if (exportType === "balance_sheet") {
      if (!dateOk(body.as_of) || (body.comparison_as_of !== undefined &&
        (!dateOk(body.comparison_as_of) || body.comparison_as_of === body.as_of))) {
        throw CommandError.validation({ as_of: "Provide valid, different as-of dates." });
      }
      parameters = { as_of: body.as_of, ...(body.comparison_as_of ? { comparison_as_of: body.comparison_as_of } : {}) };
    } else {
      if (!dateOk(body.from) || !dateOk(body.to) || body.from > body.to) throw CommandError.validation({ period: "Provide a valid statement date range." });
      parameters = { party_id: parseUuid(body.party_id, "party_id"), from: body.from, to: body.to };
    }
    const parsed = parseMutationHeaders(request.headers, { idempotency: "required" });
    if (!parsed.idempotencyKey) throw CommandError.validation({ "Idempotency-Key": "An idempotency key is required." });
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const required = ["reports.export", "exports.read"];
    if (exportType === "profit_and_loss" || exportType === "balance_sheet") required.push("reports.read");
    if (!required.every((capability) => actor.capabilities.includes(capability))) throw CommandError.forbidden();
    if ((exportType === "customer_statement" && !actor.capabilities.includes("dues.read") && !actor.capabilities.includes("sales.read")) ||
      (exportType === "vendor_statement" && !actor.capabilities.includes("dues.read") && !actor.capabilities.includes("purchases.read"))) throw CommandError.forbidden();
    const requestHash = hashCanonicalRequest({ operation: `export.${exportType}`, organizationId, payload: { format, parameters } });
    const result = await runtime.client.rpc("request_report_export", {
      p_organization_id: organizationId, p_request_id: parsed.requestId ?? requestFallback,
      p_idempotency_key: parsed.idempotencyKey, p_request_hash: requestHash,
      p_export_type: exportType, p_format: format, p_parameters: parameters
    });
    if (result.error) {
      if (result.error.code === "28000") throw CommandError.unauthenticated();
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23505") throw CommandError.conflict("IDEMPOTENCY_CONFLICT");
      if (result.error.code === "22023") throw CommandError.validation({ filters: "Check the report filters." });
      throw new Error("Report export request failed.");
    }
    const data = record(result.data);
    if (data.organization_id !== organizationId || data.export_type !== exportType || data.format !== format ||
      data.status !== "queued" || typeof data.id !== "string" || typeof data.ledger_cutoff_at !== "string") {
      throw new Error("Invalid report export response.");
    }
    const requestId = parsed.requestId ?? requestFallback;
    return Response.json({ data, meta: { request_id: requestId, replayed: data.replayed === true } },
      { status: data.replayed ? 200 : 202, headers: noStore });
  } catch (error) {
    const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, requestFallback), { status: safe.status, headers: noStore });
  }
}
