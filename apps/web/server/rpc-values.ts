import { types } from "@neondatabase/serverless";

export interface RpcArgumentMetadata {
  argument_names: readonly string[] | null;
  argument_type_oids: readonly number[];
}

/**
 * The PostgreSQL driver encodes a JavaScript array as a native SQL array, even
 * when the receiving argument is jsonb. Use the selected procedure's actual
 * input types to distinguish JSON arrays from uuid[], text[], and other arrays.
 */
export function prepareRpcArguments(
  args: Record<string, unknown>,
  metadata: RpcArgumentMetadata
): ReadonlyArray<readonly [string, unknown]> {
  const names = metadata.argument_names ?? [];
  if (names.length !== metadata.argument_type_oids.length ||
      names.length !== Object.keys(args).length ||
      names.some((name) => !Object.hasOwn(args, name))) {
    throw new Error("Database command argument metadata does not match the request.");
  }

  return names.map((name, index) => {
    const value = args[name];
    const typeOid = metadata.argument_type_oids[index];
    const isJson = typeOid === types.builtins.JSON || typeOid === types.builtins.JSONB;
    return [name, isJson && Array.isArray(value) ? JSON.stringify(value) : value] as const;
  });
}

/** Keep the RPC response contract while preserving exact amounts and bytes. */
export function normalizeRpcResult(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRpcResult);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRpcResult(item)]));
    }
  }
  // PostgreSQL DATE is already parsed as YYYY-MM-DD by database.ts. Strings,
  // including decimal amounts, remain unchanged; bytea buffers are not copied.
  return value;
}
