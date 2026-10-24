import "server-only";

import { createHash } from "node:crypto";
import { withWorkerDatabase } from "../database.ts";
import { readPrivateObject } from "../storage/private.ts";
import { attachmentScanProvider, scanFailureCode } from "./scan-providers.ts";
import { ScanProviderError, type ScanCheckpoint, type ScanReference } from "./scan-provider.ts";

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
    const provider = attachmentScanProvider();
    const args = [job.organization_id, job.attachment_id, job.lease_token, provider.name, job.sha256];
    const checkpoint: ScanCheckpoint = {
      begin: () => withWorkerDatabase(async client => {
        const result = await client.query<{ value: { created: boolean; remote_id: string | null; created_at: string } }>(
          "SELECT finance_private.begin_attachment_provider_scan($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) AS value", args);
        const row = result.rows[0]?.value;
        if (!row || typeof row.created !== "boolean" || typeof row.created_at !== "string" || (row.remote_id !== null && typeof row.remote_id !== "string")) throw new Error("Invalid scan checkpoint.");
        return { created: row.created, remoteId: row.remote_id, createdAt: row.created_at } satisfies ScanReference;
      }),
      attach: remoteId => withWorkerDatabase(async client => (await client.query<{ value: boolean }>(
        "SELECT finance_private.record_attachment_provider_scan($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) AS value", [...args, remoteId])).rows[0]?.value === true),
      abandonUnsubmitted: () => withWorkerDatabase(async client => (await client.query<{ value: boolean }>(
        "SELECT finance_private.abandon_unsubmitted_attachment_scan($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text) AS value", args)).rows[0]?.value === true)
    };
    const result = await provider.scanner.scan({ byteSize: size, sha256: job.sha256, readBytes: async () => {
      const bytes = await readPrivateObject(job.object_key);
      if (!bytes || bytes.byteLength !== size) throw new ScanProviderError("OBJECT_READ_ERROR");
      if (createHash("sha256").update(bytes).digest("hex") !== job.sha256) throw new ScanProviderError("OBJECT_DIGEST_MISMATCH");
      return bytes;
    } }, checkpoint);
    // A resumed cloud result is bound to the immutable digest and byte count
    // checked before its original upload; polling needs no second object fetch.
    return await finish(job, result.decision, job.sha256, result.engine) ? "resolved" : "lease_lost";
  } catch (error) {
    const code = scanFailureCode(error);
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
