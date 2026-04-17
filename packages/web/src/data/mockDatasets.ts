import type {
  CreateTableRequest,
  CreateTableResponse,
  DatasetColumn,
  InferSchemaRequest,
  InferSchemaResponse,
  TableDetail,
  TableRef,
} from "@athena-shell/shared";

import { mockS3 } from "./mockS3Store";
import { registerMockTable } from "./mockAthena";

export const mockDatasets = {
  async inferSchema(req: InferSchemaRequest): Promise<InferSchemaResponse> {
    if (req.fileType === "csv" || req.fileType === "tsv") {
      const text = await mockS3.getText(req.key);
      const delimiter = req.fileType === "tsv" ? "\t" : ",";
      return inferCsvSchema(text, delimiter);
    }
    if (req.fileType === "jsonl") {
      const text = await mockS3.getText(req.key);
      return { columns: inferJsonlColumns(text, 50), hasHeader: false };
    }
    if (req.fileType === "json") {
      const text = await mockS3.getText(req.key);
      return { columns: inferJsonColumns(text, 50), hasHeader: false };
    }
    if (req.fileType === "parquet") {
      return { columns: await inferParquetColumns(req.key), hasHeader: false };
    }
    return { columns: [], hasHeader: false };
  },

  async createTable(req: CreateTableRequest): Promise<CreateTableResponse> {
    const database = sanitizeIdent(req.database);
    const table = sanitizeIdent(req.table);
    const executionId = `mock-ddl-${Math.random().toString(36).slice(2, 10)}`;

    const ref: TableRef = {
      name: table,
      database,
      type: "EXTERNAL_TABLE",
      location: req.location,
    };
    const detail: TableDetail = {
      name: table,
      database,
      type: "EXTERNAL_TABLE",
      columns: req.columns,
      partitionKeys: [],
      location: req.location,
    };
    registerMockTable(ref, detail, executionId);

    return { executionId, database, table };
  },
};

const ISO_TS = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function inferJsonlColumns(text: string, maxRows: number): DatasetColumn[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const records: Record<string, unknown>[] = [];
  for (const line of lines.slice(0, maxRows)) {
    try {
      const v = JSON.parse(line);
      if (isRecord(v)) records.push(v);
    } catch {
      // skip malformed line
    }
  }
  return columnsFromRecords(records);
}

function inferJsonColumns(text: string, maxRows: number): DatasetColumn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("json file did not parse as a whole document");
  }
  if (Array.isArray(parsed)) {
    const records = parsed.filter(isRecord).slice(0, maxRows);
    if (records.length === 0) throw new Error("json array had no object records");
    return columnsFromRecords(records);
  }
  if (isRecord(parsed)) return columnsFromRecords([parsed]);
  throw new Error("json was not an object or an array of objects");
}

async function inferParquetColumns(key: string): Promise<DatasetColumn[]> {
  const { parquetMetadataAsync } = await import("hyparquet");
  const blob = await mockS3.get(key);
  const buf = await blob.arrayBuffer();
  const asyncBuffer = {
    byteLength: buf.byteLength,
    async slice(start: number, end: number = buf.byteLength): Promise<ArrayBuffer> {
      return buf.slice(start, end);
    },
  };
  const md = await parquetMetadataAsync(asyncBuffer);
  const out: DatasetColumn[] = [];
  for (let i = 1; i < md.schema.length; i++) {
    const el = md.schema[i]!;
    if (el.num_children && el.num_children > 0) continue;
    if (!el.type) continue;
    out.push({
      name: sanitizeIdent(el.name),
      type: parquetTypeToAthena(el.type),
    });
  }
  return out;
}

function parquetTypeToAthena(t: string): string {
  switch (t) {
    case "INT32":
      return "int";
    case "INT64":
      return "bigint";
    case "FLOAT":
      return "float";
    case "DOUBLE":
      return "double";
    case "BOOLEAN":
      return "boolean";
    case "INT96":
      return "timestamp";
    default:
      return "string";
  }
}

function columnsFromRecords(records: Record<string, unknown>[]): DatasetColumn[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys.map((k) => ({
    name: sanitizeIdent(k),
    type: jsonValueType(records.map((r) => r[k])),
  }));
}

function jsonValueType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return "string";
  if (nonNull.every((v) => typeof v === "boolean")) return "boolean";
  if (nonNull.every((v) => typeof v === "number" && Number.isInteger(v))) return "bigint";
  if (nonNull.every((v) => typeof v === "number")) return "double";
  if (nonNull.every((v) => typeof v === "string" && ISO_TS.test(v))) return "timestamp";
  return "string";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inferCsvSchema(text: string, delimiter: string): InferSchemaResponse {
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { columns: [], fieldDelimiter: delimiter, hasHeader: false };
  const header = rows[0]!;
  const data = rows.slice(1, 51);
  const columns: DatasetColumn[] = header.map((rawName, colIdx) => {
    const name = sanitizeIdent(rawName || `col_${colIdx + 1}`);
    const values = data.map((r) => r[colIdx] ?? "").filter((v) => v !== "");
    return { name, type: inferType(values) };
  });
  return { columns, fieldDelimiter: delimiter, hasHeader: true };
}

function inferType(samples: string[]): string {
  if (samples.length === 0) return "string";
  if (samples.every((s) => /^-?\d+$/.test(s))) return "bigint";
  if (samples.every((s) => /^-?\d+(\.\d+)?$/.test(s))) return "double";
  if (samples.every(isIsoTimestamp)) return "timestamp";
  return "string";
}

function isIsoTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
}

function parseCsv(text: string, delimiter: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => parseCsvLine(line, delimiter));
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function sanitizeIdent(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) return "c";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}
