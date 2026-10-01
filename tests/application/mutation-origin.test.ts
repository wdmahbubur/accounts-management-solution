import assert from "node:assert/strict";
import test from "node:test";
import { assertMutationOrigin } from "../../apps/web/server/auth/mutation-origin.ts";

test("cookie API origin uses configured public origin despite internal/proxied hosts", () => {
  const request = new Request("http://localhost:3000/api/roles", {
    headers: { origin: "http://127.0.0.1:3000", host: "internal:3000", "x-forwarded-host": "internal.invalid" }
  });
  assert.doesNotThrow(() => assertMutationOrigin(request.headers, "http://127.0.0.1:3000"));
  assert.doesNotThrow(() => assertMutationOrigin(new Headers({ origin: "https://app.example" }), "https://app.example/auth"));
});
test("foreign, null, absent, multi-origin and cross-site cookie mutations fail closed", () => {
  for (const origin of [null, "null", "", "https://evil.example", "https://app.example.evil.example",
    "https://app.example:444", "http://app.example", "https://app.example https://evil.example", "https://app.example/"]) {
    const headers = new Headers({ host: "evil.example", "x-forwarded-host": "evil.example" });
    if (origin !== null) headers.set("origin", origin);
    assert.throws(() => assertMutationOrigin(headers, "https://app.example"),
      (error: Error & { status?: number }) => error.status === 403);
  }
  assert.throws(() => assertMutationOrigin(new Headers({ origin: "https://app.example", "sec-fetch-site": "cross-site" }), "https://app.example"));
});
test("invalid deployment configuration never permits a cookie-authenticated mutation", () => {
  for (const configuration of ["", "relative", "data:text/plain,example", "file:///example", "https://user:pass@app.example"]) {
    assert.throws(() => assertMutationOrigin(new Headers({ origin: "https://app.example" }), configuration), /Configure a valid/);
  }
});
