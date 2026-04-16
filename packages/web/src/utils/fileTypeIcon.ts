type FileKind = "data" | "code" | "archive" | "image" | "text" | "doc" | "bin";

interface FileType {
  code: string;
  kind: FileKind;
}

const MAP: Record<string, FileType> = {
  csv: { code: "CSV", kind: "data" },
  tsv: { code: "TSV", kind: "data" },
  json: { code: "JSN", kind: "data" },
  parquet: { code: "PAR", kind: "data" },
  avro: { code: "AVR", kind: "data" },
  orc: { code: "ORC", kind: "data" },
  sql: { code: "SQL", kind: "code" },
  py: { code: "PY",  kind: "code" },
  js: { code: "JS",  kind: "code" },
  ts: { code: "TS",  kind: "code" },
  yaml: { code: "YML", kind: "code" },
  yml: { code: "YML", kind: "code" },
  toml: { code: "TOM", kind: "code" },
  txt: { code: "TXT", kind: "text" },
  md:  { code: "MD",  kind: "text" },
  log: { code: "LOG", kind: "text" },
  pdf: { code: "PDF", kind: "doc" },
  zip: { code: "ZIP", kind: "archive" },
  tar: { code: "TAR", kind: "archive" },
  gz:  { code: "GZ",  kind: "archive" },
  bz2: { code: "BZ2", kind: "archive" },
  png: { code: "PNG", kind: "image" },
  jpg: { code: "JPG", kind: "image" },
  jpeg: { code: "JPG", kind: "image" },
  gif: { code: "GIF", kind: "image" },
  svg: { code: "SVG", kind: "image" },
};

export function fileTypeIcon(name: string): FileType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MAP[ext] ?? { code: ext.slice(0, 3).toUpperCase() || "BIN", kind: "bin" };
}
