import "server-only";

import { createConnection } from "node:net";

const responseLimit = 4096;
const timeoutMs = 20_000;

export class ClamAvError extends Error {
  constructor(readonly code: "CLAMAV_UNAVAILABLE" | "SCAN_TIMEOUT" | "SCAN_PROTOCOL_ERROR", message: string) { super(message); }
}

/** Ask clamd for its loaded engine and signature database revision. */
export async function readClamAvVersion(): Promise<string> {
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT ?? "3310");
  if (!host || host.length > 253 || /[\s/\\]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ClamAvError("CLAMAV_UNAVAILABLE", "Scanner unavailable");
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: ClamAvError, version?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else if (version) resolve(version);
      else reject(new ClamAvError("SCAN_PROTOCOL_ERROR", "Invalid scanner version response"));
    };
    socket.setTimeout(timeoutMs, () => finish(new ClamAvError("SCAN_TIMEOUT", "Scanner timed out")));
    socket.once("error", () => finish(new ClamAvError("CLAMAV_UNAVAILABLE", "Scanner unavailable")));
    socket.on("data", (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.byteLength > responseLimit) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Scanner response too large"));
      const end = response.indexOf("\0");
      if (end < 0) return;
      const message = response.subarray(0, end).toString("ascii");
      const match = /^ClamAV ([^/\s]{1,32})\/(\d{1,10})\//.exec(message);
      if (!match || response.subarray(end + 1).length) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Invalid scanner version response"));
      finish(undefined, `ClamAV-${match[1]}-db${match[2]}`);
    });
    socket.once("connect", () => socket.end(Buffer.from("VERSION\0", "ascii")));
    socket.once("end", () => { if (!settled) finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete scanner response")); });
  });
}

/** Scan a private attachment through ClamAV's local, unauthenticated clamd INSTREAM protocol. */
export async function scanWithClamAv(bytes: Uint8Array): Promise<"clean" | "infected"> {
  const host = process.env.CLAMAV_HOST;
  const portText = process.env.CLAMAV_PORT ?? "3310";
  const port = Number(portText);
    if (!host || host.length > 253 || /[\s/\\]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || bytes.byteLength < 1 || bytes.byteLength > 10 * 1024 * 1024) {
    throw new ClamAvError("CLAMAV_UNAVAILABLE", "Scanner unavailable");
  }

  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, verdict?: "clean" | "infected") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else if (verdict) resolve(verdict);
      else reject(new Error("Invalid scanner response"));
    };
    socket.setTimeout(timeoutMs, () => finish(new ClamAvError("SCAN_TIMEOUT", "Scanner timed out")));
    socket.once("error", () => finish(new ClamAvError("CLAMAV_UNAVAILABLE", "Scanner unavailable")));
    socket.on("data", (chunk: Buffer) => {
      response = Buffer.concat([response, chunk]);
      if (response.byteLength > responseLimit) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Scanner response too large"));
      const end = response.indexOf("\0");
      if (end < 0) return;
      const message = response.subarray(0, end).toString("ascii");
      if (response.subarray(end + 1).length !== 0) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Unexpected scanner response data"));
      if (/^stream: OK$/.test(message)) return finish(undefined, "clean");
      if (/^stream: .+ FOUND$/.test(message)) return finish(undefined, "infected");
      finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Scanner rejected the request"));
    });
    socket.once("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "ascii"));
      for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
        const chunk = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.byteLength));
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(chunk.byteLength, 0);
        socket.write(header);
        socket.write(chunk);
      }
      const terminator = Buffer.alloc(4);
      socket.end(terminator);
    });
    socket.once("end", () => { if (!settled) finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete scanner response")); });
  });
}
