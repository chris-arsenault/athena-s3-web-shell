import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import {
  MULTIPART_PART_SIZE_BYTES,
  MULTIPART_QUEUE_SIZE,
  type AuthContext,
  type S3Listing,
  type UploadProgress,
} from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { basenameOf, isWithinPrefix } from "../utils/parseS3Path";
import { mockS3, simulateUploadProgress } from "./mockS3Store";

let cachedClient: S3Client | null = null;
let cachedRegion = "";

function clientFor(provider: AuthProvider, ctx: AuthContext): S3Client {
  if (cachedClient && cachedRegion === ctx.region) return cachedClient;
  cachedClient = new S3Client({
    region: ctx.region,
    credentials: async () => {
      const c = await provider.getCredentials();
      return {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
        sessionToken: c.sessionToken,
        expiration: new Date(c.expiration),
      };
    },
  });
  cachedRegion = ctx.region;
  return cachedClient;
}

function ensureScoped(ctx: AuthContext, key: string): void {
  if (!isWithinPrefix(key, ctx.s3.prefix)) {
    throw new Error(`Path ${key} is outside the user's workspace prefix.`);
  }
}

export async function listFolder(
  provider: AuthProvider,
  ctx: AuthContext,
  prefix: string
): Promise<S3Listing> {
  ensureScoped(ctx, prefix);
  if (provider.isMock()) return mockS3.list(prefix);

  const client = clientFor(provider, ctx);
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: ctx.s3.bucket,
      Prefix: prefix,
      Delimiter: "/",
    })
  );
  return {
    prefix,
    parents: [],
    folders: (out.CommonPrefixes ?? []).map((p) => ({
      key: p.Prefix ?? "",
      name: basenameOf(p.Prefix ?? ""),
    })),
    objects: (out.Contents ?? [])
      .filter((o) => o.Key && o.Key !== prefix)
      .map((o) => ({
        key: o.Key!,
        name: basenameOf(o.Key!),
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? "",
        etag: o.ETag,
        storageClass: o.StorageClass,
      })),
    nextToken: out.NextContinuationToken,
  };
}

export async function uploadFile(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string,
  file: File,
  initial: UploadProgress,
  onProgress: (p: UploadProgress) => void
): Promise<void> {
  ensureScoped(ctx, key);
  if (provider.isMock()) {
    await simulateUploadProgress(initial, file.size, onProgress);
    await mockS3.put(key, file, file.size);
    onProgress({ ...initial, uploaded: file.size, status: "succeeded" });
    return;
  }

  const client = clientFor(provider, ctx);
  const upload = new Upload({
    client,
    params: { Bucket: ctx.s3.bucket, Key: key, Body: file, ContentType: file.type },
    queueSize: MULTIPART_QUEUE_SIZE,
    partSize: MULTIPART_PART_SIZE_BYTES,
    leavePartsOnError: false,
  });
  upload.on("httpUploadProgress", (e) => {
    const loaded = e.loaded ?? 0;
    onProgress({ ...initial, uploaded: loaded, status: "uploading" });
  });
  await upload.done();
  onProgress({ ...initial, uploaded: file.size, status: "succeeded" });
}

export async function deleteObject(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<void> {
  ensureScoped(ctx, key);
  if (provider.isMock()) {
    mockS3.delete(key);
    return;
  }
  const client = clientFor(provider, ctx);
  await client.send(new DeleteObjectCommand({ Bucket: ctx.s3.bucket, Key: key }));
}

export async function downloadObject(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<Blob> {
  ensureScoped(ctx, key);
  if (provider.isMock()) return mockS3.get(key);
  const client = clientFor(provider, ctx);
  const out = await client.send(new GetObjectCommand({ Bucket: ctx.s3.bucket, Key: key }));
  const bytes = await out.Body!.transformToByteArray();
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer]);
}

export interface RangeFetch {
  text: string;
  truncated: boolean;
  totalSize: number;
}

export async function getObjectRange(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string,
  bytes: number
): Promise<RangeFetch> {
  ensureScoped(ctx, key);
  if (provider.isMock()) {
    const blob = await mockS3.get(key);
    const buf = await blob.arrayBuffer();
    const totalSize = buf.byteLength;
    const slice = buf.slice(0, Math.min(bytes, totalSize));
    const text = new TextDecoder().decode(slice);
    return { text, truncated: totalSize > bytes, totalSize };
  }
  const client = clientFor(provider, ctx);
  const out = await client.send(
    new GetObjectCommand({
      Bucket: ctx.s3.bucket,
      Key: key,
      Range: `bytes=0-${bytes - 1}`,
    })
  );
  const text = (await out.Body!.transformToString()) ?? "";
  const total = parseContentRangeTotal(out.ContentRange) ?? text.length;
  return { text, truncated: total > bytes, totalSize: total };
}

function parseContentRangeTotal(header?: string): number | null {
  if (!header) return null;
  const m = /\/(\d+)\s*$/.exec(header);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export async function createFolder(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<void> {
  const folderKey = key.endsWith("/") ? key : key + "/";
  ensureScoped(ctx, folderKey);
  if (provider.isMock()) {
    mockS3.mkdir(folderKey);
    return;
  }
  const client = clientFor(provider, ctx);
  await client.send(
    new PutObjectCommand({ Bucket: ctx.s3.bucket, Key: folderKey, Body: "" })
  );
}
