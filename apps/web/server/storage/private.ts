import "server-only";

import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const maxArtifactBytes = 10 * 1024 * 1024;

function validObjectKey(key: string): boolean {
  return /^[0-9a-f-]{36}\/(attachments|exports)\/[0-9a-f-]{36}$/i.test(key);
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

async function readLocalObject(key: string): Promise<Uint8Array | null> {
  const root = resolve(process.env.PRIVATE_OBJECTS_PATH ?? resolve(process.cwd(), ".local-private-objects"));
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
