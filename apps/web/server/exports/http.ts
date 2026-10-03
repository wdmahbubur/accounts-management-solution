import { parseMutationHeaders, parseOrganizationId } from "@ams/contracts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { resolveActorContext } from "../auth/resolve-actor.ts";
import { CommandError, commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId, hashCanonicalRequest } from "../commands/request-context.ts";
import { roleRuntime } from "../roles/runtime.ts";
import { record } from "../roles/contracts.ts";

const noStore = { "Cache-Control": "private, no-store" };

function failure(error: unknown, requestId: string) {
  const safe = normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, requestId), { status: safe.status, headers: noStore });
}

export async function requestTrialBalanceExport(request: Request, rawOrganizationId: string) {
  const fallbackRequestId = generateRequestId();
  try {
    assertMutationOrigin(request.headers);
    const organizationId = parseOrganizationId(rawOrganizationId);
    let raw: unknown;
    try { raw = await request.json(); } catch { throw CommandError.validation({ body: "Expected JSON." }); }
    const body = record(raw);
    if (Object.keys(body).some((key) => key !== "as_of") || typeof body.as_of !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.as_of) || !Number.isFinite(Date.parse(`${body.as_of}T00:00:00.000Z`)) ||
      new Date(`${body.as_of}T00:00:00.000Z`).toISOString().slice(0, 10) !== body.as_of) {
      throw CommandError.validation({ as_of: "Provide a valid as_of date (YYYY-MM-DD)." });
    }
    const payload = { as_of: body.as_of, format: "csv" as const };
    const parsed = parseMutationHeaders(request.headers, { idempotency: "required" });
    const requestId = parsed.requestId ?? fallbackRequestId;
    const idempotencyKey = parsed.idempotencyKey;
    if (!idempotencyKey) throw CommandError.validation({ "Idempotency-Key": "An idempotency key is required." });
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    const capabilities = ["reports.export", "exports.read", "reports.read", "accounting.read", "ledger.read"];
    if (!capabilities.every((capability) => actor.capabilities.includes(capability))) throw CommandError.forbidden();
    const requestHash = hashCanonicalRequest({ operation: "export.trial-balance", organizationId, payload });
    const result = await runtime.client.rpc("request_trial_balance_export", {
      p_organization_id: organizationId, p_request_id: requestId, p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash, p_as_of: payload.as_of, p_format: payload.format
    });
    if (result.error) {
      if (result.error.code === "28000") throw CommandError.unauthenticated();
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      if (result.error.code === "23505") throw CommandError.conflict("IDEMPOTENCY_CONFLICT");
      if (result.error.code === "22023") throw CommandError.validation({ as_of: "Check the report date and export format." });
      throw new Error("Trial balance export request failed.");
    }
    const data = record(result.data);
    if (data.organization_id !== organizationId || data.export_type !== "trial_balance" || data.format !== "csv" ||
      data.status !== "queued" || typeof data.id !== "string" || typeof data.ledger_cutoff_at !== "string" ||
      typeof data.created_at !== "string" || typeof data.replayed !== "boolean") throw new Error("Invalid export job response.");
    return Response.json({ data, meta: { request_id: requestId, replayed: data.replayed } },
      { status: data.replayed ? 200 : 202, headers: noStore });
  } catch (error) { return failure(error, fallbackRequestId); }
}

export async function listOwnExportJobs(rawOrganizationId: string) {
  const requestId = generateRequestId();
  try {
    const organizationId = parseOrganizationId(rawOrganizationId);
    const runtime = await roleRuntime();
    const actor = await resolveActorContext(organizationId, runtime.dependencies);
    if (!actor.capabilities.includes("exports.read")) throw CommandError.forbidden();
    const result = await runtime.client.rpc("list_own_export_jobs", { p_organization_id: organizationId, p_limit: 50 });
    if (result.error) {
      if (result.error.code === "28000") throw CommandError.unauthenticated();
      if (result.error.code === "42501") throw CommandError.forbidden();
      if (result.error.code === "P0002") throw CommandError.notFound();
      throw new Error("Export jobs could not be loaded.");
    }
    if (!Array.isArray(result.data) || result.data.length > 50) throw new Error("Invalid export job list response.");
    const data = result.data.map((value) => {
      const row = record(value);
      if (typeof row.id !== "string" || typeof row.export_type !== "string" || typeof row.format !== "string" ||
        typeof row.status !== "string" || typeof row.ledger_cutoff_at !== "string" || typeof row.created_at !== "string" ||
        (row.expires_at !== null && typeof row.expires_at !== "string") || (row.error_code !== null && typeof row.error_code !== "string")) {
        throw new Error("Invalid export job row.");
      }
      return row;
    });
    return Response.json({ data, meta: { request_id: requestId, replayed: false } }, { headers: noStore });
  } catch (error) { return failure(error, requestId); }
}
