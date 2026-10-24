import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeRpcResult, prepareRpcArguments } from "../../../apps/web/server/rpc-values.ts";

// Use the production argument typing and result normalization with genuine
// restricted-role transactions. Authentication is an explicitly seeded actor.
const metadata = readFileSync(new URL("../../../apps/web/server/request-client.ts", import.meta.url), "utf8")
  .match(/`(SELECT p\.proretset AS returns_set,[\s\S]*?)`/)[1];

export function fixtureRpcClient(f, actor = f.ids.owner) {
  return {
    auth: { async getUser() { return { data: { user: { id: actor } }, error: null }; } },
    async rpc(name, args = {}) {
      assert.match(name, /^[a-z_]+$/);
      try {
        const result = await f.asActor(actor, async db => {
          const signatures = (await db.query(metadata, [name])).rows;
          const signature = signatures.find(row => (row.argument_names ?? []).length === Object.keys(args).length && row.argument_names.every(key => Object.hasOwn(args, key)));
          assert.ok(signature, `Current public RPC signature exists: ${name}`);
          const ordered = prepareRpcArguments(args, signature);
          const call = `public."${name}"(${ordered.map(([key], index) => `"${key}" => $${index + 1}`).join(",")})`;
          const rows = await db.query(signature.returns_set ? `SELECT * FROM ${call}` : `SELECT ${call} AS value`, ordered.map(([, value]) => value));
          return normalizeRpcResult(signature.returns_set ? rows.rows : rows.rows[0]?.value ?? null);
        });
        return { data: result, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    }
  };
}
