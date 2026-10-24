import "server-only";
import { createHash } from "node:crypto";
import { ScanProviderError, type AttachmentScanProvider, type ScanCheckpoint, type ScanDecision, type ScanInput } from "./scan-provider.ts";

const origin = "https://api.usebouncer.dev";
const scanId = /^scan_[A-Za-z0-9_-]{8,128}$/;
const responseLimit = 256 * 1024;
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
  return value as Json;
}
export function bouncerConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const apiKey = env.BOUNCER_API_KEY, uploadHost = env.BOUNCER_UPLOAD_HOST;
  if (!apiKey || !/^bnc_live_[A-Za-z0-9_-]{16,240}$/.test(apiKey) || !uploadHost ||
      !/^bouncer-(?:dev|prod)-uploads-[0-9]{12}\.s3\.ap-south-1\.amazonaws\.com$/.test(uploadHost)) {
    throw new ScanProviderError("SCAN_PROVIDER_UNAVAILABLE");
  }
  return { apiKey, uploadHost };
}

/** Only provider-authenticated, digest-matched results can release evidence.
 * API and upload hosts are bounded separately; API credentials never go to S3.
 * No signed upload fields, provider response bodies or original filenames are logged/persisted.
 */
export class BouncerScanner implements AttachmentScanProvider {
  private readonly config: { apiKey: string; uploadHost: string };
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(config: { apiKey: string; uploadHost: string }, fetcher: typeof fetch = fetch, now: () => number = Date.now) {
    this.config = config; this.fetcher = fetcher; this.now = now;
  }

  private async request(url: string, init: RequestInit, signal: AbortSignal) {
    try { return await this.fetcher(url, { ...init, redirect: "error", cache: "no-store", signal }); }
    catch { throw new ScanProviderError(signal.aborted ? "SCAN_TIMEOUT" : "SCAN_PROVIDER_UNAVAILABLE"); }
  }
  private async json(path: string, init: RequestInit = {}): Promise<Json> {
    const signal = AbortSignal.timeout(15_000);
    const response = await this.request(origin + path, { ...init, headers: { "X-API-Key": this.config.apiKey, ...init.headers } }, signal);
    if (!response.ok) {
      await response.body?.cancel();
      throw new ScanProviderError(response.status === 429 ? "SCAN_QUOTA_EXCEEDED" : "SCAN_PROVIDER_UNAVAILABLE", response.status);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/json(?:;|$)/i.test(contentType) || Number(response.headers.get("content-length") ?? "0") > responseLimit || !response.body) {
      await response.body?.cancel(); throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    }
    const reader = response.body.getReader(); let size = 0; const parts: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > responseLimit) { await reader.cancel(); throw new ScanProviderError("SCAN_PROTOCOL_ERROR"); }
        parts.push(part.value);
      }
      const body = object(JSON.parse(Buffer.concat(parts).toString("utf8")));
      if (body.status !== "success") throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
      return object(body.data);
    } catch (error) {
      if (error instanceof ScanProviderError) throw error;
      throw new ScanProviderError(signal.aborted ? "SCAN_TIMEOUT" : "SCAN_PROTOCOL_ERROR");
    } finally { reader.releaseLock(); }
  }
  private async usage() {
    const data = await this.json("/v1/scan/usage");
    // The authorized deployment is free-tier only. Never silently use a paid plan.
    if (data.tier !== "free" || !Number.isSafeInteger(data.scans_limit) || Number(data.scans_limit) < 1 || Number(data.scans_limit) > 500 ||
        !Number.isSafeInteger(data.scans_used) || Number(data.scans_used) < 0) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    return { used: Number(data.scans_used), limit: Number(data.scans_limit) };
  }
  async check() { await this.usage(); }

  async scan(input: ScanInput, checkpoint: ScanCheckpoint): Promise<ScanDecision> {
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > 10 * 1024 * 1024 ||
        !/^[0-9a-f]{64}$/.test(input.sha256)) throw new ScanProviderError("SCAN_RESULT_MISMATCH");
    const reference = await checkpoint.begin(); let remoteId = reference.remoteId;
    if (!reference.created && !remoteId) throw new ScanProviderError("SCAN_SUBMISSION_UNCONFIRMED");
    if (reference.created) {
      let bytes: Uint8Array;
      try {
        bytes = await input.readBytes();
        if (bytes.byteLength !== input.byteSize || createHash("sha256").update(bytes).digest("hex") !== input.sha256) throw new ScanProviderError("SCAN_RESULT_MISMATCH");
        const usage = await this.usage();
        if (usage.used >= usage.limit) throw new ScanProviderError("SCAN_QUOTA_EXCEEDED");
      } catch (error) { await checkpoint.abandonUnsubmitted(); throw error; }
      // From this point an unknown outcome must not trigger another quota-consuming POST.
      let data: Json;
      try {
        data = await this.json("/v2/scan", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_name: "ams-evidence.bin", mime_type: "application/octet-stream" }) });
      } catch (error) {
        if (error instanceof ScanProviderError && [400,401,403,413,429].includes(error.httpStatus ?? 0)) await checkpoint.abandonUnsubmitted();
        throw error;
      }
      if (typeof data.scan_id !== "string" || !scanId.test(data.scan_id)) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
      remoteId = data.scan_id;
      if (!await checkpoint.attach(remoteId)) throw new ScanProviderError("SCAN_SUBMISSION_UNCONFIRMED");
      const upload = object(data.upload), fields = object(upload.fields); let target: URL;
      try { target = new URL(String(upload.url)); } catch { throw new ScanProviderError("SCAN_PROTOCOL_ERROR"); }
      const bucket = this.config.uploadHost.split(".s3.")[0];
      if (target.protocol !== "https:" || target.hostname !== this.config.uploadHost || target.port || target.username || target.password ||
          target.pathname !== "/" || target.search || target.hash || fields.bucket !== bucket ||
          typeof fields.key !== "string" || !fields.key.startsWith(`uploads/${remoteId}/`) ||
          !Number.isSafeInteger(data.max_file_size) || Number(data.max_file_size) < input.byteSize || Number(data.max_file_size) > 25 * 1024 * 1024 ||
          Object.keys(fields).length < 4 || Object.keys(fields).length > 20) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || key.toLowerCase() === "file" || typeof value !== "string" ||
            value.length < 1 || value.length > 16_384 || /[\r\n\0]/.test(value)) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
        form.append(key, value);
      }
      form.append("file", new Blob([Buffer.from(bytes)], { type: "application/octet-stream" }), "ams-evidence.bin");
      const uploaded = await this.request(target.toString(), { method: "POST", body: form }, AbortSignal.timeout(30_000));
      await uploaded.body?.cancel();
      if (uploaded.status !== 204) throw new ScanProviderError("SCAN_PROVIDER_UNAVAILABLE");
    }
    if (!remoteId || !scanId.test(remoteId)) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    const data = await this.json(`/v2/scan/${encodeURIComponent(remoteId)}`);
    if (data.scan_id !== remoteId) throw new ScanProviderError("SCAN_RESULT_MISMATCH");
    if (data.status === "pending" || data.status === "scanning") {
      const started = Date.parse(reference.createdAt);
      if (!Number.isFinite(started) || this.now() - started > 24 * 60 * 60 * 1000) throw new ScanProviderError("SCAN_PROVIDER_UNAVAILABLE");
      throw new ScanProviderError("SCAN_PENDING");
    }
    if (data.status !== "completed") throw new ScanProviderError("SCAN_PROVIDER_UNAVAILABLE");
    const file = object(data.file);
    if (file.sha256 !== input.sha256 || file.size !== input.byteSize) throw new ScanProviderError("SCAN_RESULT_MISMATCH");
    if (data.verdict !== "clean" && data.verdict !== "suspicious" && data.verdict !== "malicious") throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    const engines = object(data.engines);
    if (Object.keys(engines).length === 0 || Object.keys(engines).length > 20 || !Array.isArray(data.threats)) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    const results = Object.values(engines).map(engine => object(engine).result);
    if (results.some(result => !["clean", "suspicious", "malicious"].includes(String(result)))) throw new ScanProviderError("SCAN_PROTOCOL_ERROR");
    const clean = data.verdict === "clean" && data.threats.length === 0 && results.every(result => result === "clean");
    return { decision: clean ? "clean" : "rejected", engine: "Bouncer-api-v2" };
  }
}
