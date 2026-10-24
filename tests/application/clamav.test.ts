import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { ClamAvError, readClamAvVersion, scanWithClamAv, validateClamAvVersion } from "../../apps/web/server/artifacts/clamav.ts";

async function withClamAvMock(run: (payloads: Uint8Array[]) => Promise<void>, verdictFor: (bytes: Uint8Array) => string,
  options: { delayed?: boolean; split?: boolean; trailing?: boolean; drip?: boolean } = {}) {
  const payloads: Uint8Array[] = [];
  const server = createServer((socket) => {
    const reply = (message: string) => {
      if (options.drip) {
        const timer = setInterval(() => { if (socket.writable && !socket.destroyed) socket.write("x"); }, 2_000);
        socket.once("close", () => clearInterval(timer));
        return;
      }
      const send = () => {
        if (socket.destroyed || !socket.writable) return;
        const bytes = Buffer.from(`${message}\0`, "ascii");
        if (options.trailing) {
          socket.write(bytes);
          setTimeout(() => { if (!socket.destroyed && socket.writable) socket.end(Buffer.from("unexpected second record\0", "ascii")); }, 25);
        } else if (options.split) {
          socket.write(bytes.subarray(0, 3));
          setTimeout(() => { if (!socket.destroyed && socket.writable) socket.end(bytes.subarray(3)); }, 25);
        } else socket.end(bytes);
      };
      if (options.delayed) setTimeout(send, 25); else send();
    };
    let buffered = Buffer.alloc(0);
    let mode: "command" | "stream" = "command";
    const pieces: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const version = Buffer.from("zVERSION\0", "ascii");
      const command = Buffer.from("zINSTREAM\0", "ascii");
      if (mode === "command") {
        if (buffered.length < version.length && version.subarray(0, buffered.length).equals(buffered)) return;
        if (buffered.length < command.length && command.subarray(0, buffered.length).equals(buffered)) return;
        if (buffered.subarray(0, version.length).equals(version)) {
          reply(`ClamAV 1.4.2/27839/${new Date().toUTCString()}`);
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
          reply(verdictFor(bytes));
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

test("ClamAV adapter waits for asynchronous, fragmented replies without half-closing the request", async () => {
  await withClamAvMock(async payloads => {
    assert.equal(await readClamAvVersion(), "ClamAV-1.4.2-db27839");
    assert.equal(await scanWithClamAv(new TextEncoder().encode("Synthetic delayed evidence")), "clean");
    assert.equal(payloads.length, 1);
  }, () => "stream: OK", { delayed: true, split: true });
});

test("ClamAV adapter rejects trailing records even when they arrive after a clean verdict", async () => {
  await withClamAvMock(async () => {
    for (const operation of [readClamAvVersion, () => scanWithClamAv(new Uint8Array([1]))]) {
      await assert.rejects(operation, error => error instanceof ClamAvError && error.code === "SCAN_PROTOCOL_ERROR");
    }
  }, () => "stream: OK", { trailing: true });
});

test("ClamAV adapter cannot interpret non-ASCII bytes as the ASCII clean verdict", async () => {
  await withClamAvMock(async () => {
    await assert.rejects(() => scanWithClamAv(new Uint8Array([1])), error => error instanceof ClamAvError && error.code === "SCAN_PROTOCOL_ERROR");
  }, () => "stream: \u00cf\u00cb");
});

test("scanner's overall deadline cannot be extended by trickling response bytes", { timeout: 30_000 }, async () => {
  await withClamAvMock(async () => {
    const started = Date.now();
    await assert.rejects(readClamAvVersion, error => error instanceof ClamAvError && error.code === "SCAN_TIMEOUT");
    assert.ok(Date.now() - started < 25_000);
  }, () => "stream: OK", { drip: true });
});

test('scanner rejects expired, invalid and future signatures before a clean decision',()=>{
 const now=Date.parse('2026-10-24T08:00:00Z'),version=(date:string)=>`ClamAV 1.5.4/28162/${date}`;
 assert.equal(validateClamAvVersion(version('Sat Oct 24 07:00:00 2026 GMT'),now),'ClamAV-1.5.4-db28162');
 assert.equal(validateClamAvVersion(version('Wed Oct 21 08:00:00 2026 GMT'),now),'ClamAV-1.5.4-db28162');
 for(const date of['Wed Oct 21 07:59:59 2026 GMT','Sat Oct 24 08:30:01 2026 GMT','invalid'])assert.throws(()=>validateClamAvVersion(version(date),now),error=>error instanceof ClamAvError&&error.code==='CLAMAV_UNAVAILABLE');
 assert.throws(()=>validateClamAvVersion(version('Sat Oct 24 07:00:00 2026 GMT')+'\nextra',now),error=>error instanceof ClamAvError&&error.code==='SCAN_PROTOCOL_ERROR');
});
