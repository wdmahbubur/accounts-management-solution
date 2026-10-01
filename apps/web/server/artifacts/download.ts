import type { SupabaseClient } from "@supabase/supabase-js";
import { parseOrganizationId, parseUuid } from "@ams/contracts";
import { createSupabaseIdentityVerifier } from "../auth/supabase-identity.ts";
import { CommandError } from "../commands/errors.ts";
import { record } from "../roles/contracts.ts";
export const PRIVATE_ARTIFACT_BUCKET = "ams-private-artifacts";
export const MAX_PRIVATE_ARTIFACT_BYTES = 10 * 1024 * 1024;
export function downloadHeaders(filename: string) {
  // Never interpret an uploaded name as a header, path, or inline executable document.
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "artifact";
  return { "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safe}"`, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
}
export async function readPrivateArtifact(client: Pick<SupabaseClient, "rpc" | "storage" | "auth">,
  rawOrg: string, kind: "attachments" | "exports", rawId: string) {
  const organizationId = parseOrganizationId(rawOrg); const artifactId = parseUuid(rawId);
  if (!await createSupabaseIdentityVerifier(client).verifyIdentity()) throw CommandError.unauthenticated();
  const args = { p_organization_id: organizationId, p_kind: kind, p_artifact_id: artifactId };
  const authorized = await client.rpc("authorize_artifact_download", args);
  if (authorized.error || !Array.isArray(authorized.data) || authorized.data.length !== 1) throw CommandError.notFound();
  const descriptor = record(authorized.data[0]);
  const key = `${organizationId}/${kind}/${artifactId}`;
  if (descriptor.object_key !== key || typeof descriptor.download_filename !== "string" ||
    (descriptor.expected_size !== null && (!Number.isSafeInteger(descriptor.expected_size) ||
      Number(descriptor.expected_size) <= 0 || Number(descriptor.expected_size) > MAX_PRIVATE_ARTIFACT_BYTES))) throw CommandError.notFound();
  // The end user's JWT goes to Storage. Its operation-aware RLS rechecks live
  // membership at byte retrieval. No service key, public URL or signed bearer URL.
  const result = await client.storage.from(PRIVATE_ARTIFACT_BUCKET).download(key);
  if (result.error || !result.data || result.data.size > MAX_PRIVATE_ARTIFACT_BYTES ||
    (descriptor.expected_size !== null && result.data.size !== Number(descriptor.expected_size))) throw CommandError.notFound();
  const stillAllowed = await client.rpc("authorize_artifact_download", args);
  if (stillAllowed.error || !Array.isArray(stillAllowed.data) || stillAllowed.data.length !== 1) throw CommandError.notFound();
  return { bytes: result.data, headers: downloadHeaders(descriptor.download_filename) };
}
