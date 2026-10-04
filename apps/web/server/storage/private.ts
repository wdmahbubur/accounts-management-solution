import "server-only";

import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const maxArtifactBytes = 10 * 1024 * 1024;

function validObjectKey(key: string): boolean {
  return /^[0-9a-f-]{36}\/(attachments|exports|invoice-pdfs|imports)\/[0-9a-f-]{36}$/i.test(key);
}

function objectStoreClient(): S3Client | null {
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (!bucket) return null;
  const endpoint = process.env.OBJECT_STORE_ENDPOINT;
  const region = process.env.AWS_REGION ?? "us-east-1";
  return new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {})
  });
}

function contained(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot !== "" && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}

function localObjectsRoot(): string {
  return resolve(process.cwd(), ".local-private-objects");
}

async function readLocalObject(key: string): Promise<Uint8Array | null> {
  const root = localObjectsRoot();
  const rootReal = await realpath(root).catch(async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    return realpath(root);
  });
  const path = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, path)) return null;
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maxArtifactBytes) return null;
  const resolvedPath = await realpath(path).catch(() => null);
  if (!resolvedPath || !contained(rootReal, resolvedPath)) return null;
  return readFile(resolvedPath);
}

export async function readPrivateObject(key: string): Promise<Uint8Array | null> {
  if (!validObjectKey(key)) return null;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (!bucket) {
    if (process.env.NODE_ENV === "production") return null;
    return readLocalObject(key);
  }

  const client = objectStoreClient();
  if (!client) return null;
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body || !result.ContentLength || result.ContentLength < 1 || result.ContentLength > maxArtifactBytes) return null;
    const bytes = await result.Body.transformToByteArray();
    return bytes.byteLength <= maxArtifactBytes ? bytes : null;
  } catch {
    return null;
  } finally {
    client.destroy();
  }
}

/** Store upload bytes under an opaque generated key. This does not mark them clean. */
export async function writeQuarantinedObject(key: string, bytes: Uint8Array): Promise<boolean> {
  if (!validObjectKey(key) || !key.includes("/attachments/") || bytes.byteLength < 1 || bytes.byteLength > maxArtifactBytes) return false;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = objectStoreClient();
    if (!client) return false;
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: "application/octet-stream", IfNoneMatch: "*", Metadata: { quarantine: "pending-scan" } }));
      return true;
    } catch { return false; }
    finally { client.destroy(); }
  }
  if (process.env.NODE_ENV === "production") return false;
  const root = localObjectsRoot();
  await mkdir(root, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return false;
  const target = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, target)) return false;
  const parent = resolve(target, "..");
  await mkdir(parent, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const parentReal = await realpath(parent).catch(() => null);
  if (parentReal !== parent || !contained(rootReal, target)) return false;
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return true;
  } catch { return false; }
}

/** Store staged CSV bytes in private storage under an organization/job key. */
export async function writePrivateImportObject(key: string, bytes: Uint8Array): Promise<boolean> {
  if (!validObjectKey(key) || !key.includes("/imports/") || bytes.byteLength < 1 || bytes.byteLength > maxArtifactBytes) return false;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = objectStoreClient();
    if (!client) return false;
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: "text/csv; charset=utf-8", IfNoneMatch: "*", Metadata: { private: "true", purpose: "staged-import" } }));
      return true;
    } catch { return false; }
    finally { client.destroy(); }
  }
  if (process.env.NODE_ENV === "production") return false;
  const root = localObjectsRoot();
  await mkdir(root, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return false;
  const target = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, target)) return false;
  const parent = resolve(target, "..");
  await mkdir(parent, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const parentReal = await realpath(parent).catch(() => null);
  if (parentReal !== parent || !contained(rootReal, target)) return false;
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return true;
  } catch { return false; }
}

/** Delete only the staged import object at an organization/job path. */
export async function deletePrivateImportObject(key: string): Promise<boolean> {
  if (!validObjectKey(key) || !key.includes("/imports/")) return false;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = objectStoreClient();
    if (!client) return false;
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); return true; }
    catch { return false; }
    finally { client.destroy(); }
  }
  if (process.env.NODE_ENV === "production") return false;
  const root = localObjectsRoot();
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return true;
  const target = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, target)) return false;
  const parent = resolve(target, "..");
  const parentReal = await realpath(parent).catch(() => null);
  if (!parentReal || parentReal !== parent || !contained(rootReal, target)) return false;
  const metadata = await lstat(target).catch(() => null);
  if (!metadata) return true;
  if (!metadata.isFile() || metadata.isSymbolicLink()) return false;
  try { await rm(target); return true; } catch { return false; }
}

/** Write an immutable invoice PDF object at an opaque generated key. */
export async function writeInvoicePdfObject(key: string, bytes: Uint8Array): Promise<boolean> {
  if (!validObjectKey(key) || !key.includes("/invoice-pdfs/") || bytes.byteLength < 1 || bytes.byteLength > maxArtifactBytes ||
      new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return false;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = objectStoreClient();
    if (!client) return false;
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: "application/pdf", IfNoneMatch: "*" }));
      return true;
    } catch { return false; }
    finally { client.destroy(); }
  }
  if (process.env.NODE_ENV === "production") return false;
  const root = localObjectsRoot();
  await mkdir(root, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return false;
  const target = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, target)) return false;
  const parent = resolve(target, "..");
  await mkdir(parent, { recursive: true, mode: 0o700 }).catch(() => undefined);
  const parentReal = await realpath(parent).catch(() => null);
  if (parentReal !== parent || !contained(rootReal, target)) return false;
  try {
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return true;
  } catch { return false; }
}

/** Remove only an unregistered object created by this PDF request. */
export async function deleteInvoicePdfObject(key: string): Promise<void> {
  if (!validObjectKey(key) || !key.includes("/invoice-pdfs/")) return;
  const bucket = process.env.OBJECT_STORE_BUCKET;
  if (bucket) {
    const client = objectStoreClient();
    if (!client) return;
    try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }
    catch { /* An unreferenced immutable object can be collected by storage lifecycle policy. */ }
    finally { client.destroy(); }
    return;
  }
  if (process.env.NODE_ENV === "production") return;
  const root = localObjectsRoot();
  const rootReal = await realpath(root).catch(() => null);
  if (!rootReal) return;
  const target = resolve(rootReal, ...key.split("/"));
  if (!contained(rootReal, target)) return;
  const parent = resolve(target, "..");
  if (await realpath(parent).catch(() => null) !== parent) return;
  const metadata = await lstat(target).catch(() => null);
  if (metadata?.isFile() && !metadata.isSymbolicLink()) await rm(target, { force: true }).catch(() => undefined);
}
