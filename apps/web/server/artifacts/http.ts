import { createClient } from "../../lib/database/server.ts";
import { commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { readPrivateArtifact } from "./download.ts";
import { completeUpload, createUploadIntent } from "./uploads.ts";
import { CommandError } from "../commands/errors.ts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
import { cookies } from "next/headers";
import { assertFreshCompanySubmission, readCompanyContext } from "../company-context.ts";
import { MAX_ATTACHMENT_BYTES } from "@ams/contracts";
import { readBoundedUploadBody } from "./upload-body.ts";
export async function artifactDownload(organizationId: string, kind: "attachments" | "exports", artifactId: string) {
  try { const result = await readPrivateArtifact(await createClient(), organizationId, kind, artifactId);
    return new Response(result.bytes, { headers: result.headers });
  } catch (error) { const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: { "Cache-Control": "private, no-store" } }); }
}

async function failure(error: unknown) {
  const safe = normalizeCommandError(error);
  return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
}

async function uploadClient(organizationId: string, request: Request) {
  assertMutationOrigin(request.headers);
  const client = await createClient();
  const identity = await client.auth.getUser();
  if (!identity.data.user) throw CommandError.unauthenticated();
  try {
    assertFreshCompanySubmission({ expectedOrganizationId: organizationId, expectedNonce: request.headers.get("x-company-context"), current: readCompanyContext(await cookies()) });
  } catch { throw CommandError.conflict("STALE_VERSION", { company: "Your active company changed. Open it again before uploading." }); }
  return client;
}

export async function attachmentUploadIntent(organizationId: string, request: Request) {
  try {
    const client = await uploadClient(organizationId, request);
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedUploadBody(request, 16 * 1024))); }
    catch (error) { if (error instanceof CommandError) throw error; throw CommandError.validation({ body: "Upload details are invalid." }); }
    return Response.json({ data: await createUploadIntent(client, organizationId, body), meta: { request_id: generateRequestId() } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function attachmentUploadComplete(organizationId: string, intentId: string, request: Request) {
  try {
    const client = await uploadClient(organizationId, request);
    let form: FormData;
    try { form = await new Response(await readBoundedUploadBody(request, MAX_ATTACHMENT_BYTES + 64 * 1024), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
    catch (error) { if (error instanceof CommandError) throw error; throw CommandError.validation({ file: "Upload form is invalid." }); }
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) throw CommandError.validation({ file: "Choose one file to upload." });
    const data = await completeUpload(client, organizationId, intentId, file);
    return Response.json({ data, meta: { request_id: generateRequestId() } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
