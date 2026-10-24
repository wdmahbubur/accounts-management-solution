import assert from "node:assert/strict";
import test from "node:test";
import { attachmentIntent, attachmentMetadata, attachmentResult } from "../../apps/web/components/finance/attachment-upload-model.ts";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test("browser upload metadata hashes the selected bytes and rejects unsafe/oversized inputs", async () => {
  const metadata = await attachmentMetadata(new File(["abc"], "evidence.txt", { type: "text/plain" }));
  assert.deepEqual(metadata, { filename: "evidence.txt", content_type: "text/plain", byte_size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" });
  for (const file of [new File(["x"], "../evidence.txt", { type: "text/plain" }), new File(["x"], "evidence.html", { type: "text/html" }), new File([], "empty.txt", { type: "text/plain" }), new File([new Uint8Array(4 * 1024 * 1024 + 1)], "large.txt", { type: "text/plain" })]) await assert.rejects(() => attachmentMetadata(file));
});
test("upload destinations cannot redirect private bytes or credentials outside the selected company", () => {
  const data = { intent_id: id, expires_at: "2026-10-24T12:00:00Z", upload_url: `/api/v1/organizations/${org}/attachments/uploads/${id}/complete` };
  assert.deepEqual(attachmentIntent(data, org), { id, url: data.upload_url });
  for (const upload_url of ["https://example.invalid/upload", data.upload_url.replace(org, id), `${data.upload_url}?redirect=elsewhere`]) assert.throws(() => attachmentIntent({ ...data, upload_url }, org));
});
test("a clean download indication needs a matching upload identity and clean server verdict", () => {
  assert.equal(attachmentResult({ attachment_id: id, scan_status: "pending_scan", downloadable: false }, id).downloadable, false);
  assert.equal(attachmentResult({ attachment_id: id, scan_status: "clean", downloadable: true }, id).downloadable, true);
  for (const data of [{ attachment_id: org, scan_status: "clean", downloadable: true }, { attachment_id: id, scan_status: "pending_scan", downloadable: true }, { attachment_id: id, scan_status: "unknown", downloadable: false }]) assert.throws(() => attachmentResult(data, id));
});
