import { createClient } from "../../lib/database/server.ts";
import { commandErrorBody, normalizeCommandError } from "../commands/errors.ts";
import { generateRequestId } from "../commands/request-context.ts";
import { readPrivateArtifact } from "./download.ts";
export async function artifactDownload(organizationId: string, kind: "attachments" | "exports", artifactId: string) {
  try { const result = await readPrivateArtifact(await createClient(), organizationId, kind, artifactId);
    return new Response(result.bytes, { headers: result.headers });
  } catch (error) { const safe = normalizeCommandError(error);
    return Response.json(commandErrorBody(safe, generateRequestId()), { status: safe.status, headers: { "Cache-Control": "private, no-store" } }); }
}
