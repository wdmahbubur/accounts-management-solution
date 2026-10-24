import { CommandError } from "../commands/errors.ts";

/** Bound actual bytes as well as Content-Length, including chunked requests. */
export async function readBoundedUploadBody(request: Request, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw CommandError.validation({ file: "The upload is too large." });
  }
  if (!request.body) throw CommandError.validation({ file: "Choose a file to upload." });
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel().catch(() => undefined);
        throw CommandError.validation({ file: "The upload is too large." });
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
