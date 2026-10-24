import assert from "node:assert/strict";
import test from "node:test";
import { readBoundedObject } from "../../apps/web/server/storage/read-bounded.ts";

test("private object reads require the exact declared bytes across stream chunks", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3])); c.close(); } });
  assert.deepEqual(await readBoundedObject(body, 3, new AbortController().signal), Buffer.from([1, 2, 3]));
  assert.equal(await readBoundedObject(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }), 2, new AbortController().signal), null);
});

test("an oversized storage body is cancelled before it can grow past the descriptor", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(4)); }, cancel() { cancelled = true; } });
  assert.equal(await readBoundedObject(body, 3, new AbortController().signal), null); assert.equal(cancelled, true);
});

test("a stalled private body is cancelled by the same request deadline", async () => {
  const abort = new AbortController(); let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => undefined); }, cancel() { cancelled = true; } });
  const reading = readBoundedObject(body, 1, abort.signal); abort.abort();
  assert.equal(await reading, null); assert.equal(cancelled, true);
});

test("a broken storage stream never returns partial evidence", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); c.error(new Error("Synthetic storage disconnect")); } });
  assert.equal(await readBoundedObject(body, 2, new AbortController().signal), null);
});
