/**
 * Parse a Glue/Athena `StorageDescriptor.Location` (s3://bucket/path/)
 * into `{ bucket, prefix }`. Normalizes a trailing slash onto `prefix`
 * because Glue locations are always folder-scoped.
 *
 * Returns `null` for malformed input rather than throwing — callers
 * treat a missing location as "no crosslink affordance," not an error.
 */
export interface S3Location {
  bucket: string;
  prefix: string;
}

const S3_URL = /^s3:\/\/([^/]+)\/(.*)$/;

export function locationToPrefix(location: string | undefined | null): S3Location | null {
  if (!location) return null;
  const m = S3_URL.exec(location.trim());
  if (!m) return null;
  const bucket = m[1]!;
  const raw = m[2] ?? "";
  if (!bucket) return null;
  const prefix = raw.endsWith("/") || raw === "" ? raw : `${raw}/`;
  return { bucket, prefix };
}
