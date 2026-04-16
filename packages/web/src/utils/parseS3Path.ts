export interface ParsedS3Path {
  bucket: string;
  key: string;
}

export function parseS3Path(url: string): ParsedS3Path {
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(url);
  if (!m) throw new Error(`Not an s3:// URL: ${url}`);
  return { bucket: m[1]!, key: m[2]! };
}

export function joinPrefix(...parts: string[]): string {
  const cleaned = parts
    .map((p) => p.replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter(Boolean);
  return cleaned.length === 0 ? "" : cleaned.join("/") + "/";
}

export function basenameOf(key: string): string {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const i = trimmed.lastIndexOf("/");
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

export function isWithinPrefix(key: string, prefix: string): boolean {
  if (key.includes("..")) return false;
  return key.startsWith(prefix);
}
