import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_TTL_SECONDS = 15 * 60;

export interface ParsedS3Url {
  bucket: string;
  key: string;
}

export function parseS3Url(url: string): ParsedS3Url {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(url);
  if (!m) throw new Error(`Not an s3:// URL: ${url}`);
  return { bucket: m[1]!, key: m[2]! };
}

export async function presignResultsDownload(
  client: S3Client,
  outputLocation: string
): Promise<string> {
  const { bucket, key } = parseS3Url(outputLocation);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_TTL_SECONDS,
  });
}
