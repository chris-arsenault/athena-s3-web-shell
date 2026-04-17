import {
  CopyObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { AthenaClient } from "@aws-sdk/client-athena";

import { getQuery } from "./queryService.js";
import { parseS3Url } from "./resultsService.js";

/**
 * Copies an Athena result CSV from the workgroup results bucket into
 * the caller's workspace prefix, preserving the original `.csv` so
 * the file is usable without post-processing.
 *
 * Server-side because the browser's per-user STS credentials are
 * scoped to the user's prefix — they can't read from the workgroup
 * results bucket. The proxy's task role has read access there.
 *
 * Also optionally drops a `.sql` sidecar with the statement text so
 * the artifact carries its provenance.
 */

export interface SaveToWorkspaceResult {
  targetBucket: string;
  targetKey: string;
  sourceKey: string;
  size?: number;
  sidecarKey?: string;
}

export interface SaveToWorkspaceInput {
  targetBucket: string;
  targetKey: string;
  includeSqlSidecar: boolean;
  overwrite: boolean;
}

export async function copyResultToWorkspace(
  athena: AthenaClient,
  s3: S3Client,
  executionId: string,
  input: SaveToWorkspaceInput
): Promise<SaveToWorkspaceResult> {
  const status = await getQuery(athena, executionId);
  if (status.state !== "SUCCEEDED") {
    throw new HttpError(409, `query ${executionId} is not in SUCCEEDED state`);
  }
  if (!status.outputLocation) {
    throw new HttpError(500, `query ${executionId} has no outputLocation`);
  }
  const source = parseS3Url(status.outputLocation);

  if (!input.overwrite && (await objectExists(s3, input.targetBucket, input.targetKey))) {
    throw new HttpError(409, `target already exists: ${input.targetKey}`);
  }

  await s3.send(
    new CopyObjectCommand({
      Bucket: input.targetBucket,
      Key: input.targetKey,
      CopySource: `${source.bucket}/${encodeURIComponent(source.key)}`,
      MetadataDirective: "COPY",
    })
  );

  const sidecarKey = input.includeSqlSidecar ? swapExtension(input.targetKey, ".sql") : undefined;
  if (sidecarKey) {
    await s3.send(
      new PutObjectCommand({
        Bucket: input.targetBucket,
        Key: sidecarKey,
        Body: status.sql,
        ContentType: "text/plain; charset=utf-8",
      })
    );
  }

  return {
    targetBucket: input.targetBucket,
    targetKey: input.targetKey,
    sourceKey: source.key,
    sidecarKey,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.$metadata?.httpStatusCode === 404 || err.name === "NotFound") return false;
    throw e;
  }
}

function swapExtension(key: string, newExt: string): string {
  const idx = key.lastIndexOf(".");
  if (idx === -1) return key + newExt;
  return key.slice(0, idx) + newExt;
}
