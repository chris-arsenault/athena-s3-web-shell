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
    if (req.fileType !== "csv" && req.fileType !== "tsv") {
      return { columns: [], hasHeader: false };
    }
    const blob = await mockS3.get(req.key);
    const text = await blob.text();
    const delimiter = req.fileType === "tsv" ? "\t" : ",";
    return inferCsvSchema(text, delimiter);
  },

  async createTable(req: CreateTableRequest): Promise<CreateTableResponse> {
    const database = sanitizeIdent(req.database);
    const table = sanitizeIdent(req.table);
    const executionId = `mock-ddl-${Math.random().toString(36).slice(2, 10)}`;

    const ref: TableRef = { name: table, database, type: "EXTERNAL_TABLE" };
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
