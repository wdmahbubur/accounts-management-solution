import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { ClamAvError, readClamAvVersion, scanWithClamAv } from "../../apps/web/server/artifacts/clamav.ts";

async function withClamAvMock(run: (payloads: Uint8Array[]) => Promise<void>, verdictFor: (bytes: Uint8Array) => string) {
  const payloads: Uint8Array[] = [];
  const server = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let mode: "command" | "stream" = "command";
    const pieces: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const version = Buffer.from("VERSION\0", "ascii");
      const command = Buffer.from("zINSTREAM\0", "ascii");
      if (mode === "command") {
        if (buffered.length < version.length && version.subarray(0, buffered.length).equals(buffered)) return;
        if (buffered.length < command.length && command.subarray(0, buffered.length).equals(buffered)) return;
        if (buffered.subarray(0, version.length).equals(version)) {
          socket.end(Buffer.from("ClamAV 1.4.2/27839/Sat Oct 04 10:33:00 2026\0", "ascii"));
          return;
        }
        if (!buffered.subarray(0, command.length).equals(command)) return socket.destroy();
        buffered = buffered.subarray(command.length);
        mode = "stream";
      }
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        if (length === 0) {
          const bytes = Buffer.concat(pieces);
          payloads.push(bytes);
          socket.end(Buffer.from(`${verdictFor(bytes)}\0`, "ascii"));
          return;
        }
        if (buffered.length < length + 4) return;
        pieces.push(buffered.subarray(4, length + 4));
        buffered = buffered.subarray(length + 4);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const oldHost = process.env.CLAMAV_HOST;
  const oldPort = process.env.CLAMAV_PORT;
  process.env.CLAMAV_HOST = "127.0.0.1";
  process.env.CLAMAV_PORT = String((server.address() as { port: number }).port);
  try { await run(payloads); }
  finally {
    if (oldHost === undefined) delete process.env.CLAMAV_HOST; else process.env.CLAMAV_HOST = oldHost;
    if (oldPort === undefined) delete process.env.CLAMAV_PORT; else process.env.CLAMAV_PORT = oldPort;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("ClamAV adapter reads loaded signature revision and frames INSTREAM payloads", async () => {
  const sample = new TextEncoder().encode("pdf payload");
  await withClamAvMock(async (payloads) => {
    assert.equal(await readClamAvVersion(), "ClamAV-1.4.2-db27839");
    assert.equal(await scanWithClamAv(sample), "clean");
    assert.deepEqual(payloads, [Buffer.from(sample)]);
  }, () => "stream: OK");
});

test("ClamAV adapter treats FOUND as rejected and unknown scanner results as errors", async () => {
  await withClamAvMock(async () => {
    assert.equal(await scanWithClamAv(new TextEncoder().encode("EICAR")), "infected");
  }, () => "stream: Eicar-Test-Signature FOUND");
  await withClamAvMock(async () => {
    await assert.rejects(scanWithClamAv(new Uint8Array([1])), (error: unknown) =>
      error instanceof ClamAvError && error.code === "SCAN_PROTOCOL_ERROR");
  }, () => "stream: ERROR");
});
