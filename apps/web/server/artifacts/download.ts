import { createHash } from "node:crypto";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import type { RequestClient } from "../request-client.ts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
import { readPrivateObject } from "../storage/private.ts";
export const MAX_PRIVATE_ARTIFACT_BYTES = 10 * 1024 * 1024;
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
  const key = `${organizationId}/${kind}/${artifactId}`;
  if (descriptor.object_key !== key || typeof descriptor.download_filename !== "string" ||
    typeof descriptor.expected_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(descriptor.expected_sha256) ||
    (descriptor.expected_size !== null && (!Number.isSafeInteger(descriptor.expected_size) ||
      Number(descriptor.expected_size) <= 0 || Number(descriptor.expected_size) > MAX_PRIVATE_ARTIFACT_BYTES))) throw CommandError.notFound();
  const bytes = await readObject(key);
  if (!bytes || bytes.byteLength > MAX_PRIVATE_ARTIFACT_BYTES ||
    (descriptor.expected_size !== null && bytes.byteLength !== Number(descriptor.expected_size)) ||
    createHash("sha256").update(bytes).digest("hex") !== descriptor.expected_sha256) throw CommandError.notFound();
  const stillAllowed = await client.rpc("authorize_artifact_download", args);
  if (stillAllowed.error || !Array.isArray(stillAllowed.data) || stillAllowed.data.length !== 1) throw CommandError.notFound();
  return { bytes: new Blob([bytes as BlobPart]), headers: downloadHeaders(descriptor.download_filename) };
}
