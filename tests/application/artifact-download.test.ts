import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readPrivateArtifact, downloadHeaders } from "../../apps/web/server/artifacts/download.ts";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
function fixture(options: { revokedAfterDownload?: boolean; wrongKey?: boolean; wrongSize?: boolean; wrongDigest?: boolean; storageDenied?: boolean; size?: unknown; kind?: "attachments" | "exports" | "invoice-pdfs" } = {}) {
  const calls: string[] = []; let authCount = 0;
  const bytes = new TextEncoder().encode("TEST");
  const client = { rpc: async () => { calls.push("authorize"); authCount++;
      if (options.revokedAfterDownload && authCount === 2) return { data: null, error: { code: "P0002" } };
      return { data: [{ object_key: options.wrongKey ? `elsewhere/${id}` : `${org}/${options.kind ?? "attachments"}/${id}`, download_filename: 'evidence.pdf',
        expected_size: Object.hasOwn(options, "size") ? options.size : options.wrongSize ? 9 : bytes.byteLength,
        expected_sha256: options.wrongDigest ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex") }], error: null };
    } } as unknown as Parameters<typeof readPrivateArtifact>[0];
  const readObject = async (key: string) => {
    calls.push("storage"); assert.equal(key, `${org}/${options.kind ?? "attachments"}/${id}`);
    return options.storageDenied ? null : bytes;
  };
  return { client, calls, readObject };
}
test("private download uses ordinary identity, exact metadata key and a second live check, returning non-cacheable bytes", async () => {
  const f = fixture(); const result = await readPrivateArtifact(f.client, org, "attachments", id, f.readObject);
  assert.equal(await result.bytes.text(), "TEST"); assert.deepEqual(f.calls, ["authorize", "storage", "authorize"]);
  assert.equal(result.headers["Content-Type"], "application/octet-stream"); assert.match(result.headers["Cache-Control"], /no-store/);
});
test("private downloads deny wrong organization key, removed identity, storage denial, size mismatch and mid-fetch revocation", async () => {
  for (const options of [{ wrongKey: true }, { storageDenied: true }, { wrongSize: true }, { wrongDigest: true }, { revokedAfterDownload: true }]) {
    const f = fixture(options); await assert.rejects(() => readPrivateArtifact(f.client, org, "attachments", id, f.readObject));
    if (options.wrongKey) assert.ok(!f.calls.includes("storage"));
  }
});
test("untrusted filename cannot inject a header or render executable content inline", () => {
  const h = downloadHeaders('../../name"\r\nSet-Cookie:evil=<script>.html');
  assert.doesNotMatch(h["Content-Disposition"], /\r|\n|Set-Cookie:|<script>/);
  assert.match(h["Content-Disposition"], /^attachment;/); assert.equal(h["X-Content-Type-Options"], "nosniff");
});

test("private downloads accept PostgreSQL bigint byte counts for every artifact kind", async () => {
  for (const kind of ["attachments", "exports", "invoice-pdfs"] as const) {
    const f = fixture({ kind, size: "4" });
    assert.equal(await (await readPrivateArtifact(f.client, org, kind, id, f.readObject)).bytes.text(), "TEST");
    assert.deepEqual(f.calls, ["authorize", "storage", "authorize"]);
  }
});

test("private downloads reject malformed, oversized or mismatched bigint metadata", async () => {
  for (const size of [undefined, "", "0", "-4", "4.0", "4e0", " 4", "04", "10485761", "9007199254740993", true, {}, 0, 1.5, NaN, "5"]) {
    const f = fixture({ size });
    await assert.rejects(() => readPrivateArtifact(f.client, org, "attachments", id, f.readObject));
    if (size !== "5") assert.ok(!f.calls.includes("storage"));
  }
});
