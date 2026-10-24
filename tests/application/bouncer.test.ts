import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { BouncerScanner, bouncerConfiguration } from "../../apps/web/server/artifacts/bouncer.ts";
import { ScanProviderError, type ScanCheckpoint } from "../../apps/web/server/artifacts/scan-provider.ts";
import { attachmentScanProvider } from "../../apps/web/server/artifacts/scan-providers.ts";

const config = { apiKey: `bnc_live_${randomBytes(24).toString("hex")}`, uploadHost: "bouncer-dev-uploads-000000000000.s3.ap-south-1.amazonaws.com" };
const bytes = new TextEncoder().encode("Synthetic evidence"), input = { byteSize: bytes.length, readBytes: async () => bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
const id = "scan_SYNTHETIC00000001";
const result = (verdict = "clean") => ({ scan_id: id, status: "completed", verdict, file: { sha256: input.sha256, size: bytes.length },
  threats: verdict === "clean" ? [] : ["synthetic threat"], engines: { signature: { result: verdict } } });
function checkpoint(remoteId: string | null = null, started = false) {
  let exists = started || remoteId !== null, stored = remoteId, abandoned = 0;
  const cp: ScanCheckpoint = {
    begin: async () => { const created = !exists; exists = true; return { created, remoteId: stored, createdAt: new Date().toISOString() }; },
    attach: async value => { stored = value; return true; },
    abandonUnsubmitted: async () => { exists = false; abandoned++; return true; }
  };
  return { cp, value: () => ({ exists, stored, abandoned }) };
}
function fixture(options: { usage?: object; created?: object; completed?: object; createStatus?: number; uploadStatus?: number; oversized?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes(".amazonaws.com")) return new Response(null, { status: options.uploadStatus ?? 204 });
    let data: object, status = 200;
    if (String(url).endsWith("/usage")) data = options.usage ?? { tier: "free", scans_used: 3, scans_limit: 500 };
    else if (init.method === "POST") {
      status = options.createStatus ?? 201;
      data = options.created ?? { scan_id: id, max_file_size: 25 * 1024 * 1024, upload: { url: `https://${config.uploadHost}/`, fields: {
        bucket: config.uploadHost.split(".s3.")[0], key: `uploads/${id}/ams-evidence.bin`, Policy: "synthetic", "X-Amz-Signature": "synthetic"
      } } };
    } else data = options.completed ?? result();
    return new Response(options.oversized ? "x".repeat(256 * 1024 + 1) : JSON.stringify({ status: "success", data }), { status, headers: { "Content-Type": "application/json" } });
  };
  return { scanner: new BouncerScanner(config, fake), calls };
}
const code = (expected: string) => (error: unknown) => error instanceof ScanProviderError && error.code === expected;

test("Bouncer uses server-authenticated v2 uploads, anonymized names and exact digest-matched clean verdicts", async () => {
  const f = fixture(), c = checkpoint();
  assert.deepEqual(await f.scanner.scan(input, c.cp), { decision: "clean", engine: "Bouncer-api-v2" });
  assert.equal(f.calls.length, 4); assert.equal(c.value().stored, id);
  for (const request of f.calls) assert.equal(request.init.redirect, "error");
  const upload = f.calls.find(r => r.url.includes(".amazonaws.com"))!;
  assert.equal(upload.init.headers, undefined, "Never send the API key to the upload target.");
  const file = (upload.init.body as FormData).get("file") as File;
  assert.equal(file.name, "ams-evidence.bin"); assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.deepEqual(JSON.parse(String(f.calls[1]!.init.body)), { file_name: "ams-evidence.bin", mime_type: "application/octet-stream" });
});
test("a resumed scan only polls its saved reference and consumes no new upload", async () => {
  const f = fixture(), c = checkpoint(id);
  await f.scanner.scan({ ...input, readBytes: async () => { throw new Error("A resumed scan must not download private object bytes again."); } }, c.cp);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0]!.init.method, undefined);
});
test("pending scan preserves its reference across retries instead of creating another scan", async () => {
  const f = fixture({ completed: { scan_id: id, status: "scanning" } }), c = checkpoint();
  await assert.rejects(() => f.scanner.scan(input, c.cp), code("SCAN_PENDING"));
  assert.equal(c.value().stored, id);
  const resumed = fixture(); await resumed.scanner.scan(input, c.cp);
  assert.equal(f.calls.filter(r => r.init.method === "POST" && !r.url.includes("amazonaws")).length, 1);
  assert.equal(resumed.calls.length, 1);
});
test("malicious, suspicious and contradictory clean reports never release a file", async () => {
  for (const completed of [result("malicious"), result("suspicious"), { ...result(), threats: ["synthetic threat"] },
    { ...result(), engines: { signature: { result: "malicious" } } }]) {
    assert.equal((await fixture({ completed }).scanner.scan(input, checkpoint(id).cp)).decision, "rejected");
  }
});
test("wrong scan id, size or digest and incomplete/unknown results fail closed", async () => {
  for (const completed of [{ ...result(), scan_id: "scan_OTHER00000001" }, { ...result(), file: { ...result().file, sha256: "0".repeat(64) } },
    { ...result(), file: { ...result().file, size: bytes.length + 1 } }]) {
    await assert.rejects(() => fixture({ completed }).scanner.scan(input, checkpoint(id).cp), code("SCAN_RESULT_MISMATCH"));
  }
  for (const completed of [{ ...result(), verdict: "unknown" }, { ...result(), engines: {} }, { ...result(), engines: { signature: { result: "error" } } },
    { ...result(), threats: null }]) await assert.rejects(() => fixture({ completed }).scanner.scan(input, checkpoint(id).cp), code("SCAN_PROTOCOL_ERROR"));
  await assert.rejects(() => fixture({ completed: { scan_id: id, status: "failed" } }).scanner.scan(input, checkpoint(id).cp), code("SCAN_PROVIDER_UNAVAILABLE"));
});
test("free-tier quota and paid/invalid plans cannot start an upload", async () => {
  const c = checkpoint(), f = fixture({ usage: { tier: "free", scans_used: 500, scans_limit: 500 } });
  await assert.rejects(() => f.scanner.scan(input, c.cp), code("SCAN_QUOTA_EXCEEDED"));
  assert.equal(f.calls.length, 1); assert.equal(c.value().abandoned, 1);
  for (const usage of [{ tier: "pro", scans_used: 0, scans_limit: 10000 }, { tier: "free", scans_used: -1, scans_limit: 500 }]) {
    await assert.rejects(() => fixture({ usage }).scanner.check(), code("SCAN_PROTOCOL_ERROR"));
  }
});
test("explicit create rejection can retry later; ambiguous create outcome never resubmits blindly", async () => {
  const rejected = fixture({ createStatus: 429 }), c = checkpoint();
  await assert.rejects(() => rejected.scanner.scan(input, c.cp), code("SCAN_QUOTA_EXCEEDED")); assert.equal(c.value().abandoned, 1);
  const ambiguous = fixture({ createStatus: 500 }), unknown = checkpoint();
  await assert.rejects(() => ambiguous.scanner.scan(input, unknown.cp), code("SCAN_PROVIDER_UNAVAILABLE"));
  assert.equal(unknown.value().abandoned, 0); const count = ambiguous.calls.length;
  await assert.rejects(() => ambiguous.scanner.scan(input, unknown.cp), code("SCAN_SUBMISSION_UNCONFIRMED")); assert.equal(ambiguous.calls.length, count);
});
test("unapproved upload destinations and forged fields are rejected without sending file bytes", async () => {
  for (const url of ["http://127.0.0.1/", "https://other.example.invalid/", `https://${config.uploadHost}/?secret=x`, `https://${config.uploadHost}/other`]) {
    const f = fixture({ created: { scan_id: id, max_file_size: 25 * 1024 * 1024, upload: { url, fields: {} } } });
    await assert.rejects(() => f.scanner.scan(input, checkpoint().cp), code("SCAN_PROTOCOL_ERROR")); assert.equal(f.calls.length, 2);
  }
});
test("oversized responses, mismatched local bytes, unknown providers and missing configuration fail closed", async () => {
  await assert.rejects(() => fixture({ oversized: true }).scanner.check(), code("SCAN_PROTOCOL_ERROR"));
  await assert.rejects(() => fixture().scanner.scan({ ...input, sha256: "0".repeat(64) }, checkpoint().cp), code("SCAN_RESULT_MISMATCH"));
  assert.throws(() => bouncerConfiguration({}), code("SCAN_PROVIDER_UNAVAILABLE"));
  assert.throws(() => bouncerConfiguration({ BOUNCER_API_KEY: config.apiKey, BOUNCER_UPLOAD_HOST: "127.0.0.1" }), code("SCAN_PROVIDER_UNAVAILABLE"));
  const previous = process.env.ATTACHMENT_SCAN_PROVIDER;
  try { process.env.ATTACHMENT_SCAN_PROVIDER = "other"; assert.throws(attachmentScanProvider, code("SCAN_PROVIDER_UNAVAILABLE")); }
  finally { if (previous === undefined) delete process.env.ATTACHMENT_SCAN_PROVIDER; else process.env.ATTACHMENT_SCAN_PROVIDER = previous; }
});

test("lost checkpoint fence stops the upload, and an expired pending scan never becomes clean", async () => {
  const lost = fixture(), cp = checkpoint().cp;
  await assert.rejects(() => lost.scanner.scan(input, { ...cp, attach: async () => false }), code("SCAN_SUBMISSION_UNCONFIRMED"));
  assert.equal(lost.calls.length, 2);
  const pending = fixture({ completed: { scan_id: id, status: "pending" } });
  await assert.rejects(() => pending.scanner.scan(input, { ...checkpoint(id).cp,
    begin: async () => ({ created: false, remoteId: id, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }) }), code("SCAN_PROVIDER_UNAVAILABLE"));
});
