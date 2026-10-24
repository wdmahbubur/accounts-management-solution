import "server-only";

import { createConnection } from "node:net";

const responseLimit = 4096;
const timeoutMs = 20_000;

/** Refuse new clean decisions when signatures are stale or the clock disagrees. */
export function validateClamAvVersion(message: string, now = Date.now()): string {
  const match = /^ClamAV ([^/\s]{1,32})\/(\d{1,10})\/([^\r\n\0]{1,100})$/.exec(message);
  if (!match) throw new ClamAvError("SCAN_PROTOCOL_ERROR", "Invalid scanner version response");
  const updated = Date.parse(match[3]!);
  if (!Number.isFinite(updated) || !Number.isFinite(now) || now - updated > 72 * 60 * 60 * 1000 || updated - now > 30 * 60 * 1000) {
    throw new ClamAvError("CLAMAV_UNAVAILABLE", "Scanner signatures unavailable or outdated");
  }
  return `ClamAV-${match[1]}-db${match[2]}`;
}

export class ClamAvError extends Error {
  readonly code: "CLAMAV_UNAVAILABLE" | "SCAN_TIMEOUT" | "SCAN_PROTOCOL_ERROR";
  constructor(code: "CLAMAV_UNAVAILABLE" | "SCAN_TIMEOUT" | "SCAN_PROTOCOL_ERROR", message: string) {
    super(message);
    this.code = code;
  }
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
    const deadline = setTimeout(() => finish(new ClamAvError("SCAN_TIMEOUT", "Scanner timed out")), timeoutMs);
    const finish = (error?: ClamAvError, version?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
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
    });
    socket.once("end", () => {
      if (settled) return;
      const end = response.indexOf("\0");
      if (end !== response.length - 1 || end < 0 || response.some(byte => byte > 127)) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete or invalid scanner response"));
      const message = response.subarray(0, end).toString("ascii");
      try { finish(undefined, validateClamAvVersion(message)); }
      catch (error) { finish(error instanceof ClamAvError ? error : new ClamAvError("SCAN_PROTOCOL_ERROR", "Invalid scanner version response")); }
    });
    socket.once("connect", () => socket.write(Buffer.from("zVERSION\0", "ascii")));
    socket.once("close", () => { if (!settled) finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete scanner response")); });
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
    const deadline = setTimeout(() => finish(new ClamAvError("SCAN_TIMEOUT", "Scanner timed out")), timeoutMs);
    const finish = (error?: Error, verdict?: "clean" | "infected") => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
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
    });
    socket.once("end", () => {
      if (settled) return;
      const end = response.indexOf("\0");
      if (end !== response.length - 1 || end < 0 || response.some(byte => byte > 127)) return finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete or invalid scanner response"));
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
      // INSTREAM ends with the zero-length chunk, not a TCP half-close.
      // Keep the connection open while clamd performs its asynchronous scan.
      socket.write(terminator);
    });
    socket.once("close", () => { if (!settled) finish(new ClamAvError("SCAN_PROTOCOL_ERROR", "Incomplete scanner response")); });
  });
}
