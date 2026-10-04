import { createClient } from "../../lib/database/server.ts";
import { commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { readPrivateArtifact } from "./download.ts";
import { completeUpload, createUploadIntent } from "./uploads.ts";
import { CommandError } from "../commands/errors.ts";
import { assertMutationOrigin } from "../auth/mutation-origin.ts";
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

export async function attachmentUploadIntent(organizationId: string, request: Request) {
  try {
    assertMutationOrigin(request.headers);
    const body = await request.json();
    return Response.json({ data: await createUploadIntent(await createClient(), organizationId, body), meta: { request_id: generateRequestId() } },
      { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}

export async function attachmentUploadComplete(organizationId: string, intentId: string, request: Request) {
  try {
    assertMutationOrigin(request.headers);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 10 * 1024 * 1024 + 64 * 1024) throw CommandError.validation({ file: "File must be at most 10 MiB." });
    let form: FormData;
    try { form = await request.formData(); } catch { throw CommandError.validation({ file: "Upload form is invalid." }); }
    const file = form.get("file");
    if (!(file instanceof File)) throw CommandError.validation({ file: "Choose a file to upload." });
    const data = await completeUpload(await createClient(), organizationId, intentId, file);
    return Response.json({ data, meta: { request_id: generateRequestId() } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
