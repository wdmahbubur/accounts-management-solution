import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
import { readPrivateObject } from "../storage/private.ts";
export const MAX_PRIVATE_ARTIFACT_BYTES = 10 * 1024 * 1024;
function artifactSize(raw: unknown): number | null {
  if (raw === null) return null;
  // The PostgreSQL bigint driver returns text; JSON-backed adapters return numbers.
  // Convert only bounded byte counts here, never global numeric/money values.
  const value = typeof raw === "string" && /^[1-9]\d{0,7}$/.test(raw) ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_PRIVATE_ARTIFACT_BYTES) {
    throw CommandError.notFound();
  }
  return value;
}
export function downloadHeaders(filename: string) {
  // Never interpret an uploaded name as a header, path, or inline executable document.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "artifact";
  return { "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safe}"`, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}
export async function readPrivateArtifact(client: Pick<RequestClient, "rpc">,
  rawOrg: string, kind: "attachments" | "exports" | "invoice-pdfs", rawId: string,
  readObject: (key: string) => Promise<Uint8Array | null> = readPrivateObject) {
  const organizationId = parseOrganizationId(rawOrg); const artifactId = parseUuid(rawId);
  const args = { p_organization_id: organizationId, p_kind: kind, p_artifact_id: artifactId };
  const authorized = await client.rpc("authorize_artifact_download", args);
  if (authorized.error || !Array.isArray(authorized.data) || authorized.data.length !== 1) throw CommandError.notFound();
  const descriptor = record(authorized.data[0]);
  const expectedSize = artifactSize(descriptor.expected_size);
  const key = `${organizationId}/${kind}/${artifactId}`;
  if (descriptor.object_key !== key || typeof descriptor.download_filename !== "string" ||
    typeof descriptor.expected_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(descriptor.expected_sha256)) throw CommandError.notFound();
  const bytes = await readObject(key);
  if (!bytes || bytes.byteLength > MAX_PRIVATE_ARTIFACT_BYTES ||
    (expectedSize !== null && bytes.byteLength !== expectedSize) ||
    createHash("sha256").update(bytes).digest("hex") !== descriptor.expected_sha256) throw CommandError.notFound();
  const stillAllowed = await client.rpc("authorize_artifact_download", args);
  if (stillAllowed.error || !Array.isArray(stillAllowed.data) || stillAllowed.data.length !== 1) throw CommandError.notFound();
  return { bytes: new Blob([bytes as BlobPart]), headers: downloadHeaders(descriptor.download_filename) };
}
