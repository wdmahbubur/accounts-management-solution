import assert from "node:assert/strict";
import test from "node:test";
import { completeUpload } from "../../apps/web/server/artifacts/uploads.ts";
import { readBoundedUploadBody } from "../../apps/web/server/artifacts/upload-body.ts";
import { CommandError } from "../../apps/web/server/commands/errors.ts";

test("an unauthorized or unconfirmed upload cannot read or write private objects", async () => {
  const file = new File(["Synthetic evidence"], "evidence.txt", { type: "text/plain" });
  for (const code of ["28000", "42501", "P0002", "22023", "42883", null]) {
    let storageCalls = 0;
    const client = { async rpc() { return { data: code ? null : false, error: code ? { code } : null }; } };
    const store = { async write() { storageCalls++; return true; }, async read() { storageCalls++; return null; } };
    await assert.rejects(() => completeUpload(client, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", file, store), error => error instanceof CommandError);
    assert.equal(storageCalls, 0);
  }
});

test("upload retry uses the same authorized object and retains a completed scan verdict", async () => {
  const file = new File(["Synthetic evidence"], "evidence.txt", { type: "text/plain" });
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const status of ["pending", "clean", "rejected"]) {
    const calls: string[] = [];
    const client = { async rpc(name: string) { calls.push(name); return name === "authorize_attachment_upload_completion" ? { data: true, error: null } : { data: [{ attachment_id: id, scan_status: status }], error: null }; } };
    const store = { async write(key: string) { calls.push(key); return false; }, async read() { return new TextEncoder().encode("Synthetic evidence"); } };
    const result = await completeUpload(client, org, id, file, store);
    assert.deepEqual(calls, ["authorize_attachment_upload_completion", `${org}/attachments/${id}`, "complete_attachment_upload"]);
    assert.equal(result.scan_status, status === "pending" ? "pending_scan" : status); assert.equal(result.downloadable, status === "clean");
  }
});

test("chunked upload bodies stop at the real byte bound without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(64)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/upload", { method: "POST", body, duplex: "half" } as RequestInit);
  await assert.rejects(() => readBoundedUploadBody(request, 128), error => error instanceof CommandError && error.code === "VALIDATION_FAILED");
  assert.equal(cancelled, true);
  assert.deepEqual(await readBoundedUploadBody(new Request("http://localhost/upload", { method: "POST", body: "short" }), 128), new TextEncoder().encode("short"));
});
