import { createHash } from "node:crypto";
import { parseOrganizationId } from "@ams/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorContext } from "../auth/types.ts";
import { CommandError } from "../commands/errors.ts";
import { validReportDate } from "./ledger.ts";

type ExportClient = Pick<SupabaseClient, "rpc" | "from">;
type RequestInput = { asOf: string; from?: string };
function parseInput(raw: unknown): RequestInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw CommandError.validation({ body: "Expected an export request." });
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["as_of", "from", "format"].includes(key)) || value.format !== "csv") throw CommandError.validation({ format: "Only CSV trial-balance exports are currently available." });
  if (typeof value.as_of !== "string" || !validReportDate(value.as_of) || (value.from !== undefined && value.from !== null && (typeof value.from !== "string" || !validReportDate(value.from)))) throw CommandError.validation({ date_range: "Choose valid report dates." });
  const from = typeof value.from === "string" ? value.from : undefined;
  if (from && from > value.as_of) throw CommandError.validation({ date_range: "The start date must be on or before the report date." });
  return { asOf: value.as_of, from };
}
export async function requestTrialBalanceExport(client: ExportClient, actor: ActorContext, raw: unknown, idempotencyKey: string | null) {
  if (!actor.capabilities.includes("reports.read") || !actor.capabilities.includes("reports.export") ||
    !actor.capabilities.includes("accounting.read") || !actor.capabilities.includes("ledger.read") || !actor.capabilities.includes("exports.read")) throw CommandError.forbidden();
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) throw CommandError.validation({ idempotency_key: "Supply a stable Idempotency-Key for this export request." });
  const input = parseInput(raw);
  const canonical = JSON.stringify({ export_type: "trial_balance", as_of: input.asOf, from: input.from ?? null, format: "csv" });
  const requestHash = createHash("sha256").update(canonical).digest("hex");
  const { data, error } = await client.rpc("request_trial_balance_export", {
    p_organization_id: parseOrganizationId(actor.organizationId), p_as_of: input.asOf, p_from: input.from ?? null,
    p_format: "csv", p_idempotency_key: idempotencyKey, p_request_hash: requestHash
  });
  if (error) {
    if (error.code === "42501") throw CommandError.forbidden();
    if (error.code === "23505") throw CommandError.conflict("IDEMPOTENCY_CONFLICT");
    if (error.code === "22023") throw CommandError.validation({ export: "The report export request is invalid." });
    throw new CommandError({ code: "INTERNAL_ERROR" });
  }
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  if (!row || typeof row.export_job_id !== "string" || typeof row.ledger_cutoff_at !== "string" || typeof row.status !== "string" || typeof row.replayed !== "boolean") throw new CommandError({ code: "INTERNAL_ERROR" });
  return { exportJobId: row.export_job_id, cutoffAt: row.ledger_cutoff_at, status: row.status, replayed: row.replayed };
}

export async function readExportJobs(client: ExportClient, actor: ActorContext) {
  if (!actor.capabilities.includes("exports.read")) throw CommandError.forbidden();
  const { data, error } = await (client as any).from("export_jobs")
    .select("id,export_type,parameters,ledger_cutoff_at,format,status,object_key,expires_at,error_code,created_at,completed_at,result_size")
    .eq("organization_id", parseOrganizationId(actor.organizationId)).order("created_at", { ascending: false }).limit(50);
  if (error) {
    if (error.code === "42501") throw CommandError.forbidden();
    throw new CommandError({ code: "INTERNAL_ERROR" });
  }
  if (!Array.isArray(data)) throw new CommandError({ code: "INTERNAL_ERROR" });
  return data.map((row: Record<string, unknown>) => ({ ...row, id: String(row.id) }));
}
