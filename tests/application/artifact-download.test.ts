import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPrivateArtifact, downloadHeaders } from "../../apps/web/server/artifacts/download.ts";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
function fixture(options: { revokedAfterDownload?: boolean; wrongKey?: boolean; missingIdentity?: boolean; wrongSize?: boolean; storageDenied?: boolean } = {}) {
  const calls: string[] = []; let authCount = 0;
  const client = { auth: { getUser: async () => ({ data: { user: options.missingIdentity ? null : { id: "11111111-1111-4111-8111-111111111111" } }, error: null }) },
    rpc: async () => { calls.push("authorize"); authCount++;
      if (options.revokedAfterDownload && authCount === 2) return { data: null, error: { code: "P0002" } };
      return { data: [{ object_key: options.wrongKey ? `elsewhere/${id}` : `${org}/attachments/${id}`, download_filename: 'evidence.pdf', expected_size: options.wrongSize ? 9 : 4 }], error: null };
    }, storage: { from: (bucket: string) => ({ download: async (key: string) => {
      calls.push("storage"); assert.equal(bucket, "ams-private-artifacts"); assert.equal(key, `${org}/attachments/${id}`);
      return { data: options.storageDenied ? null : new Blob(["TEST"]), error: options.storageDenied ? { message: "Denied" } : null };
    } }) }
  } as unknown as Pick<SupabaseClient, "rpc" | "auth" | "storage">;
  return { client, calls };
}
test("private download uses ordinary identity, exact metadata key and a second live check, returning non-cacheable bytes", async () => {
  const f = fixture(); const result = await readPrivateArtifact(f.client, org, "attachments", id);
  assert.equal(await result.bytes.text(), "TEST"); assert.deepEqual(f.calls, ["authorize", "storage", "authorize"]);
  assert.equal(result.headers["Content-Type"], "application/octet-stream"); assert.match(result.headers["Cache-Control"], /no-store/);
});
test("private downloads deny wrong organization key, removed identity, storage denial, size mismatch and mid-fetch revocation", async () => {
  for (const options of [{ wrongKey: true }, { missingIdentity: true }, { storageDenied: true }, { wrongSize: true }, { revokedAfterDownload: true }]) {
    const f = fixture(options); await assert.rejects(() => readPrivateArtifact(f.client, org, "attachments", id));
    if (options.wrongKey || options.missingIdentity) assert.ok(!f.calls.includes("storage"));
  }
});
test("untrusted filename cannot inject a header or render executable content inline", () => {
  const h = downloadHeaders('../../name"\r\nSet-Cookie:evil=<script>.html');
  assert.doesNotMatch(h["Content-Disposition"], /\r|\n|Set-Cookie:|<script>/);
  assert.match(h["Content-Disposition"], /^attachment;/); assert.equal(h["X-Content-Type-Options"], "nosniff");
});
