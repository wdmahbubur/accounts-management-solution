import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { PRIVATE_ARTIFACT_BUCKET } from "../artifacts/download.ts";
import { OutboxDeliveryError, type OutboxEvent, type OutboxHandler } from "./worker.ts";

const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  // Prefix formula-like text before CSV quoting; keep numeric strings exact.
  if (/^[\s\u0000-\u0020]*[=+@]/.test(text) || /^[\s\u0000-\u0020]*-/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function trialBalanceCsv(report: Record<string, unknown>) {
  const accounts = Array.isArray(report.accounts) ? report.accounts.map(object) : [];
  const lines: unknown[][] = [
    ["Company", report.company], ["Report", "Trial Balance"], ["From", report.from_date],
    ["As of", report.as_of], ["Currency", report.currency], ["Generated at", report.generated_at], [],
    ["Account code", "Account name", "Account type", "Opening debit", "Opening credit", "Movement debit", "Movement credit", "Closing debit", "Closing credit"],
    ...accounts.map((row) => [row.code, row.name, row.account_type, row.opening_debit, row.opening_credit,
      row.movement_debit, row.movement_credit, row.closing_debit, row.closing_credit]),
    [], ["Total debit", report.total_debit], ["Total credit", report.total_credit]
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
function exportId(event: OutboxEvent) {
  const id = object(event.payload).export_job_id;
  try { return parseUuid(id, "export_job_id"); } catch { throw new OutboxDeliveryError("EXPORT_EVENT_INVALID", false); }
}
type ExportClient = Pick<SupabaseClient, "rpc" | "storage">;

/** Render from the immutable request cutoff, then store to the private org/job key. */
export function trialBalanceExportHandler(client: ExportClient): OutboxHandler {
  return async ({ event }) => {
    const organizationId = parseOrganizationId(event.organization_id);
    const jobId = exportId(event);
    const state = await client.rpc("get_export_job_state", { p_organization_id: organizationId, p_export_job_id: jobId });
    if (state.error || !Array.isArray(state.data) || state.data.length !== 1) throw new OutboxDeliveryError("EXPORT_JOB_UNAVAILABLE", false);
    if (state.data[0].status === "completed") return;
    const started = await client.rpc("start_export_job", { p_organization_id: organizationId, p_export_job_id: jobId });
    if (started.error || started.data !== true) throw new OutboxDeliveryError("EXPORT_JOB_NOT_STARTABLE", false);
    const report = await client.rpc("build_trial_balance_export", { p_organization_id: organizationId, p_export_job_id: jobId });
    if (report.error) {
      const revoked = report.error.code === "42501";
      await client.rpc("fail_export_job", { p_organization_id: organizationId, p_export_job_id: jobId,
        p_error_code: revoked ? "EXPORT_PERMISSION_REVOKED" : "EXPORT_RENDER_FAILED" });
      throw new OutboxDeliveryError(revoked ? "EXPORT_PERMISSION_REVOKED" : "EXPORT_RENDER_FAILED", !revoked);
    }
    const text = trialBalanceCsv(object(report.data));
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length < 1 || bytes.length > MAX_EXPORT_BYTES) {
      await client.rpc("fail_export_job", { p_organization_id: organizationId, p_export_job_id: jobId, p_error_code: "EXPORT_TOO_LARGE" });
      throw new OutboxDeliveryError("EXPORT_TOO_LARGE", false);
    }
    const key = `${organizationId}/exports/${jobId}`;
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const upload = await client.storage.from(PRIVATE_ARTIFACT_BUCKET).upload(key, bytes, {
      contentType: "text/csv; charset=utf-8", cacheControl: "0", upsert: true
    });
    if (upload.error) throw new OutboxDeliveryError("EXPORT_STORAGE_FAILED", true);
    const completed = await client.rpc("complete_export_job", { p_organization_id: organizationId,
      p_export_job_id: jobId, p_object_key: key, p_sha256: sha256, p_byte_size: bytes.length });
    if (completed.error || completed.data !== true) {
      await client.storage.from(PRIVATE_ARTIFACT_BUCKET).remove([key]);
      await client.rpc("fail_export_job", { p_organization_id: organizationId, p_export_job_id: jobId, p_error_code: "EXPORT_PERMISSION_REVOKED" });
      throw new OutboxDeliveryError("EXPORT_FINALIZE_FAILED", true);
    }
  };
}
