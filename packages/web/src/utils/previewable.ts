// Extensions whose bytes can be decoded as UTF-8 and meaningfully shown
// in the preview drawer. Binary formats (parquet, zip, png, …) are off-
// list even though they might fall under fileTypeIcon's `data`/`image`
// kinds — we don't want to splat non-text bytes into a <pre>.
const TEXT_EXTENSIONS = new Set([
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
  "json",
  "jsonl",
  "ndjson",
  "csv",
  "tsv",
  "html",
  "css",
  "sh",
  "env",
  "ini",
  "xml",
]);

export function isPreviewable(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}
