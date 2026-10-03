import "server-only";

import { createHash } from "node:crypto";
import { withWorkerDatabase } from "../database.ts";
import { readPrivateObject } from "../storage/private.ts";
import { ClamAvError, readClamAvVersion, scanWithClamAv } from "./clamav.ts";

type ClaimedScan = {
  attachment_id: string;
  organization_id: string;
  object_key: string;
  byte_size: string | number;
  sha256: string;
  lease_token: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function finish(job: ClaimedScan, decision: "clean" | "rejected", observed: string | null, engine: string | null) {
  return withWorkerDatabase(async client => {
    const result = await client.query<{ finished: boolean }>(
      "SELECT finance_private.finish_attachment_scan($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) AS finished",
      [job.organization_id, job.attachment_id, job.lease_token, decision, observed, engine]
    );
    return result.rows[0]?.finished === true;
  });
}

async function fail(job: ClaimedScan, code: string) {
  return withWorkerDatabase(async client => {
    const result = await client.query<{ failed: boolean }>(
      "SELECT finance_private.fail_attachment_scan($1::uuid,$2::uuid,$3::uuid,$4::text) AS failed",
      [job.organization_id, job.attachment_id, job.lease_token, code]
    );
    return result.rows[0]?.failed === true;
  });
}

type ScanOutcome = "resolved" | "retry_queued" | "lease_lost";

async function scan(job: ClaimedScan): Promise<ScanOutcome> {
  try {
    const size = Number(job.byte_size);
    if (!uuidPattern.test(job.organization_id) || !uuidPattern.test(job.attachment_id) || !uuidPattern.test(job.lease_token) ||
        job.object_key !== `${job.organization_id}/attachments/${job.attachment_id}` ||
        !Number.isSafeInteger(size) || size < 1 || size > 10 * 1024 * 1024 || !/^[0-9a-f]{64}$/.test(job.sha256)) {
      return await fail(job, "SCAN_WORKER_ERROR") ? "retry_queued" : "lease_lost";
    }
    const bytes = await readPrivateObject(job.object_key);
    if (!bytes || bytes.byteLength !== size) return await fail(job, "OBJECT_READ_ERROR") ? "retry_queued" : "lease_lost";
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== job.sha256) return await fail(job, "OBJECT_DIGEST_MISMATCH") ? "retry_queued" : "lease_lost";
    const engine = await readClamAvVersion();
    const verdict = await scanWithClamAv(bytes);
    return await finish(job, verdict === "clean" ? "clean" : "rejected", digest, engine) ? "resolved" : "lease_lost";
  } catch (error) {
    const code = error instanceof ClamAvError ? error.code : "SCAN_WORKER_ERROR";
    try { return await fail(job, code) ? "retry_queued" : "lease_lost"; }
    catch { return "lease_lost"; }
  }
}

export async function processAttachmentScanBatch(limit = 10) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 10;
  const claimed = await withWorkerDatabase(client => client.query<ClaimedScan>(
    "SELECT * FROM finance_private.claim_attachment_scans($1::integer,$2::integer)", [safeLimit, 300]
  ));
  const outcomes = await Promise.all(claimed.rows.map(scan));
  return { claimed: claimed.rows.length,
    resolved: outcomes.filter(outcome => outcome === "resolved").length,
    retry_queued: outcomes.filter(outcome => outcome === "retry_queued").length,
    lease_lost: outcomes.filter(outcome => outcome === "lease_lost").length };
}
