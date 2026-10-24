import "server-only";

/** Bound actual bytes and stalled bodies, not only the storage Content-Length. */
export async function readBoundedObject(body: ReadableStream<Uint8Array>, expectedSize: number, signal: AbortSignal): Promise<Uint8Array | null> {
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) { cancel(); return null; }
    while (true) {
      const part = await reader.read();
      if (signal.aborted) return null;
      if (part.done) break;
      size += part.value.byteLength;
      if (size > expectedSize) { await reader.cancel(); return null; }
      chunks.push(part.value);
    }
    return size === expectedSize ? Buffer.concat(chunks, size) : null;
  } catch { return null; }
  finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
