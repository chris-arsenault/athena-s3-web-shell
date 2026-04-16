const MAP: Record<string, string> = {
  csv: "📊",
  tsv: "📊",
  json: "🧾",
  parquet: "📦",
  txt: "📄",
  md: "📄",
  log: "📄",
  pdf: "📕",
  zip: "🗜️",
  gz: "🗜️",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
};

export function fileTypeIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MAP[ext] ?? "📄";
}
