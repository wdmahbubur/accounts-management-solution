import "server-only";

import { createHash } from "node:crypto";
import { withDatabase } from "../database.ts";
import { readPrivateObject } from "../storage/private.ts";
import { deletePrivateExport, putPrivateExport } from "./private-storage.ts";

type ExportJob = {
  job_id: string;
  organization_id: string;
  requester_member_id: string;
  company_name: string;
  parameters: { as_of?: unknown };
  ledger_cutoff_at: string;
  created_at: string;
  lease_token: string;
  attempt_count: number;
};
type ExportRow = {
  company_name: string; currency: string; as_of: string; ledger_cutoff_at: string; generated_at: string;
  account_code: string; account_name: string; account_type: string; opening_balance: string;
  movement_debit: string; movement_credit: string; closing_debit: string; closing_credit: string;
};

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function money(value: string): string {
  if (!/^-?\d{1,18}(?:\.\d{1,2})?$/.test(value)) throw Object.assign(new Error("Invalid database amount"), { safeCode: "EXPORT_INVALID_REPORT_DATA" });
  return value;
}
function numericCell(value: string): string {
  return `"${money(value)}"`;
}

function renderCsv(rows: ExportRow[]): Uint8Array {
  if (!rows.length) throw Object.assign(new Error("Trial balance has no account rows"), { safeCode: "EXPORT_EMPTY_REPORT" });
  const first = rows[0]!;
  const lines = [
    ["Report", "Trial balance"], ["Company", first.company_name], ["As of", first.as_of], ["Currency", first.currency],
    ["Generated at", first.generated_at], ["Ledger cutoff at", first.ledger_cutoff_at], ["Provisional", "No"], [],
    ["Account code", "Account name", "Account type", "Opening balance", "Movement debit", "Movement credit", "Closing debit", "Closing credit"],
    ...rows.map((row) => [row.account_code, row.account_name, row.account_type, row.opening_balance,
      row.movement_debit, row.movement_credit, row.closing_debit, row.closing_credit])
  ];
  const csv = "\uFEFF" + lines.map((line, lineIndex) => line.map((value, column) =>
    lineIndex >= 9 && column >= 3 ? numericCell(value) : csvCell(value)
  ).join(",")).join("\r\n") + "\r\n";
  return new TextEncoder().encode(csv);
}

function errorCode(error: unknown): string {
  const safe = (error as { safeCode?: unknown }).safeCode;
  return typeof safe === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(safe) ? safe : "EXPORT_RENDER_FAILED";
}

async function process(job: ExportJob): Promise<"completed" | "retried" | "stale"> {
  const key = `${job.organization_id}/exports/${job.job_id}`;
  try {
    const result = await withDatabase((client) => client.query<ExportRow>(
      "SELECT * FROM finance_private.read_trial_balance_export($1::uuid,$2::uuid)", [job.job_id, job.lease_token]
    ));
    const bytes = renderCsv(result.rows);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!await putPrivateExport(key, bytes)) {
      const existing = await readPrivateObject(key);
      if (!existing || createHash("sha256").update(existing).digest("hex") !== digest) {
        throw Object.assign(new Error("Private export storage unavailable"), { safeCode: "EXPORT_STORAGE_FAILED" });
      }
    }
    const completed = await withDatabase((client) => client.query<{ completed: boolean }>(
      "SELECT finance_private.complete_trial_balance_export($1::uuid,$2::uuid,$3::bigint,$4::text) AS completed",
      [job.job_id, job.lease_token, bytes.byteLength, digest]
    ));
    if (completed.rows[0]?.completed) return "completed";
    await deletePrivateExport(key);
    return "stale";
  } catch (error) {
    // A stale lease belongs to a replacement worker. Its result must not be overwritten or deleted.
    const code = errorCode(error);
    try {
      await withDatabase((client) => client.query(
        "SELECT finance_private.fail_trial_balance_export($1::uuid,$2::uuid,$3::text)", [job.job_id, job.lease_token, code]
      ));
      return "retried";
    } catch { return "stale"; }
  }
}

export async function processTrialBalanceExportBatch(limit = 3) {
  const claimed = await withDatabase((client) => client.query<ExportJob>(
    "SELECT * FROM finance_private.claim_trial_balance_exports($1::integer,$2::integer)", [limit, 600]
  ));
  let completed = 0; let retried = 0; let stale = 0;
  for (const job of claimed.rows) {
    const result = await process(job);
    if (result === "completed") completed++;
    else if (result === "retried") retried++;
    else stale++;
  }
  return { claimed: claimed.rowCount ?? claimed.rows.length, completed, retried, stale };
}
