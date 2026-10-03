import "server-only";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const maxBytes = 10 * 1024 * 1024;
const validKey = (key: string) => /^[0-9a-f-]{36}\/exports\/[0-9a-f-]{36}$/i.test(key);
const store = () => {
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (!bucket) return null;
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-1",
    ...(process.env.OBJECT_STORE_ENDPOINT ? { endpoint: process.env.OBJECT_STORE_ENDPOINT, forcePathStyle: true } : {}) });
};
const contained = (root: string, target: string) => {
  const path = relative(root, target);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
};

export async function putPrivateExport(key: string, bytes: Uint8Array): Promise<boolean> {
  if (!validKey(key) || bytes.byteLength < 1 || bytes.byteLength > maxBytes) return false;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = store();
    if (!client) return false;
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: "text/csv; charset=utf-8", IfNoneMatch: "*", Metadata: { private: "true", format: "csv" } }));
      return true;
    } catch { return false; }
    finally { client.destroy(); }
  }
  if (process.env.NODE_ENV === "production") return false;
  const root = resolve(process.env.PRIVATE_OBJECTS_PATH ?? resolve(process.cwd(), ".local-private-objects"));
  await mkdir(root, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot) return false;
  const target = resolve(realRoot, ...key.split("/"));
  if (!contained(realRoot, target)) return false;
  const parent = resolve(target, "..");
  await mkdir(parent, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const realParent = await realpath(parent).catch(() => null);
  if (!realParent || realParent.toLowerCase() !== parent.toLowerCase() || !contained(realRoot, target)) return false;
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return true;
  } catch { return false; }
}

export async function deletePrivateExport(key: string): Promise<void> {
  if (!validKey(key)) return;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = store();
    if (!client) return;
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
    catch { /* The inaccessible object can be removed by private bucket lifecycle policy. */ }
    finally { client.destroy(); }
    return;
  }
  if (process.env.NODE_ENV === "production") return;
  const root = resolve(process.env.PRIVATE_OBJECTS_PATH ?? resolve(process.cwd(), ".local-private-objects"));
  const realRoot = await realpath(root).catch(() => null);
  if (!realRoot) return;
  const target = resolve(realRoot, ...key.split("/"));
  if (!contained(realRoot, target)) return;
  const info = await lstat(target).catch(() => null);
  if (info?.isFile() && !info.isSymbolicLink()) await rm(target, { force: true }).catch(() => undefined);
}
