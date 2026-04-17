export type PreviewKind =
  | "text"
  | "image"
  | "csv"
  | "tsv"
  | "jsonl"
  | "json"
  | "parquet"
  | "none";

const TEXT_EXT = new Set([
  "txt",
  "md",
  "log",
  "sql",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "yaml",
  "yml",
  "toml",
  "html",
  "css",
  "sh",
  "env",
  "ini",
  "xml",
]);

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

export function previewKind(name: string): PreviewKind {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "json") return "json";
  if (ext === "parquet") return "parquet";
  if (TEXT_EXT.has(ext)) return "text";
  return "none";
}

export function isPreviewable(name: string): boolean {
  return previewKind(name) !== "none";
}

function extOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}
