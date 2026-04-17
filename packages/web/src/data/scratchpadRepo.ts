import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import type { AuthContext } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { isWithinPrefix } from "../utils/parseS3Path";
import { buildS3ClientConfig } from "./s3Repo";
import { mockS3 } from "./mockS3Store";

/**
 * S3-backed `.sql` scratchpad files under `<prefix>/queries/`.
 * Browser-direct — uses the user's STS creds. The IAM role already
 * grants s3:* over the user's prefix, so no new proxy surface.
 *
 * Keys outside `<prefix>/queries/` are rejected at this layer (even
 * though the IAM role permits the whole prefix) to prevent accidental
 * writes to adjacent workspace paths.
 */

const SCRATCHPAD_SUFFIX = "queries/";
const NAME_PATTERN = /^[A-Za-z0-9_./-]+\.sql$/;

export interface ScratchpadFile {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  etag?: string;
}

export interface ScratchpadReadResult {
  content: string;
  etag?: string;
}

export function scratchpadPrefix(ctx: AuthContext): string {
  return ctx.s3.prefix + SCRATCHPAD_SUFFIX;
}

export function validateScratchpadKey(ctx: AuthContext, key: string): void {
  const root = scratchpadPrefix(ctx);
  if (!isWithinPrefix(key, root)) {
    throw new Error(`Scratchpad key ${key} outside ${root}`);
  }
  const rel = key.slice(root.length);
  if (!NAME_PATTERN.test(rel)) {
    throw new Error(`Invalid scratchpad filename: ${rel}`);
  }
}

export async function listScratchpadFiles(
  provider: AuthProvider,
  ctx: AuthContext
): Promise<ScratchpadFile[]> {
  const root = scratchpadPrefix(ctx);
  if (provider.isMock()) {
    return mockS3.list(root).objects
      .filter((o) => o.name.endsWith(".sql"))
      .map((o) => ({
        key: o.key,
        name: o.key.slice(root.length),
        size: o.size,
        lastModified: o.lastModified,
        etag: o.etag,
      }));
  }
  const client = await buildClient(provider, ctx);
  return listRecursive(client, ctx.s3.bucket, root);
}

async function listRecursive(
  client: S3Client,
  bucket: string,
  root: string
): Promise<ScratchpadFile[]> {
  const out: ScratchpadFile[] = [];
  let token: string | undefined;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: root,
        ContinuationToken: token,
      })
    );
    for (const o of resp.Contents ?? []) {
      if (!o.Key || !o.Key.endsWith(".sql")) continue;
      out.push({
        key: o.Key,
        name: o.Key.slice(root.length),
        size: o.Size ?? 0,
        lastModified: o.LastModified?.toISOString() ?? "",
        etag: o.ETag,
      });
    }
    token = resp.NextContinuationToken;
  } while (token);
  return out;
}

export async function readScratchpad(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<ScratchpadReadResult> {
  validateScratchpadKey(ctx, key);
  if (provider.isMock()) {
    return { content: await mockS3.getText(key), etag: mockEtagFor(ctx, key) };
  }
  const client = await buildClient(provider, ctx);
  const out = await client.send(
    new GetObjectCommand({ Bucket: ctx.s3.bucket, Key: key })
  );
  const content = (await out.Body!.transformToString()) ?? "";
  return { content, etag: out.ETag };
}

export async function writeScratchpad(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string,
  content: string,
  expectedEtag?: string
): Promise<{ etag?: string }> {
  validateScratchpadKey(ctx, key);
  if (provider.isMock()) {
    if (expectedEtag && mockS3.exists(key) && mockEtagFor(ctx, key) !== expectedEtag) {
      throw etagMismatchError(key);
    }
    await mockS3.put(key, content, content.length);
    return { etag: mockEtagFor(ctx, key) };
  }
  const client = await buildClient(provider, ctx);
  try {
    const out = await client.send(
      new PutObjectCommand({
        Bucket: ctx.s3.bucket,
        Key: key,
        Body: content,
        ContentType: "text/plain; charset=utf-8",
        IfMatch: expectedEtag,
      })
    );
    return { etag: out.ETag };
  } catch (e) {
    const err = e as { $metadata?: { httpStatusCode?: number } };
    if (err.$metadata?.httpStatusCode === 412) throw etagMismatchError(key);
    throw e;
  }
}

export async function renameScratchpad(
  provider: AuthProvider,
  ctx: AuthContext,
  sourceKey: string,
  targetKey: string
): Promise<void> {
  validateScratchpadKey(ctx, sourceKey);
  validateScratchpadKey(ctx, targetKey);
  if (provider.isMock()) {
    mockS3.copy(sourceKey, targetKey);
    mockS3.delete(sourceKey);
    return;
  }
  const client = await buildClient(provider, ctx);
  await client.send(
    new CopyObjectCommand({
      Bucket: ctx.s3.bucket,
      Key: targetKey,
      CopySource: `${ctx.s3.bucket}/${encodeURIComponent(sourceKey)}`,
      MetadataDirective: "COPY",
    })
  );
  await client.send(new DeleteObjectCommand({ Bucket: ctx.s3.bucket, Key: sourceKey }));
}

export async function deleteScratchpad(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<void> {
  validateScratchpadKey(ctx, key);
  if (provider.isMock()) {
    mockS3.delete(key);
    return;
  }
  const client = await buildClient(provider, ctx);
  await client.send(new DeleteObjectCommand({ Bucket: ctx.s3.bucket, Key: key }));
}

async function buildClient(
  provider: AuthProvider,
  ctx: AuthContext
): Promise<S3Client> {
  const { S3Client: Client } = await import("@aws-sdk/client-s3");
  return new Client(buildS3ClientConfig(provider, ctx));
}

function mockEtagFor(ctx: AuthContext, key: string): string {
  const obj = mockS3.list(scratchpadPrefix(ctx)).objects.find((o) => o.key === key);
  return obj?.lastModified ? `"${obj.lastModified}"` : `"mock"`;
}

function etagMismatchError(key: string): Error {
  const err = new Error(`${key} changed externally since last read`);
  (err as Error & { code: string }).code = "etag_mismatch";
  return err;
}
