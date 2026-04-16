import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { type AthenaClient } from "@aws-sdk/client-athena";

import type {
  AthenaScope,
  CreateTableRequest,
  CreateTableResponse,
  DatasetColumn,
  DatasetFileType,
  InferSchemaResponse,
} from "@athena-shell/shared";

import {
  createDatabaseDdl,
  ddlForRequest,
  sanitizeIdent,
} from "./ddlTemplates.js";
import { startQuery, getQuery } from "./queryService.js";

const DEFAULT_SAMPLE_BYTES = 65536;
const SAMPLE_DATA_ROWS = 50;
const ENSURE_DB_POLL_INTERVAL_MS = 400;
const ENSURE_DB_POLL_TIMEOUT_MS = 30_000;

export async function inferSchema(
  s3: S3Client,
  bucket: string,
  key: string,
  fileType: DatasetFileType,
  sampleBytes: number = DEFAULT_SAMPLE_BYTES
): Promise<InferSchemaResponse> {
  if (fileType !== "csv" && fileType !== "tsv") {
    // JSON/Parquet inference is out of v1 scope — return empty so the UI
    // can let the user fill in columns manually.
    return { columns: [], hasHeader: false };
  }
  const text = await fetchSample(s3, bucket, key, sampleBytes);
  const delimiter = fileType === "tsv" ? "\t" : ",";
  return inferCsvSchema(text, delimiter);
}

export async function createTable(
  athena: AthenaClient,
  scope: AthenaScope,
  request: CreateTableRequest
): Promise<CreateTableResponse> {
  // Ensure the per-user database exists before issuing the CREATE TABLE.
  await ensureDatabase(athena, scope, request.database);
  const sql = ddlForRequest(request);
  const { executionId } = await startQuery(athena, scope, { sql });
  return { executionId, database: request.database, table: request.table };
}

// ----------------------------------------------------------------------------

async function fetchSample(
  s3: S3Client,
  bucket: string,
  key: string,
  bytes: number
): Promise<string> {
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${bytes - 1}`,
    })
  );
  if (!out.Body) throw new Error(`No body on S3 GetObject for s3://${bucket}/${key}`);
  const bytesBuf = await out.Body.transformToByteArray();
  return new TextDecoder().decode(bytesBuf);
}

function inferCsvSchema(text: string, delimiter: string): InferSchemaResponse {
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { columns: [], fieldDelimiter: delimiter, hasHeader: false };
  const header = rows[0]!;
  const sample = rows.slice(1, 1 + SAMPLE_DATA_ROWS);
  const columns: DatasetColumn[] = header.map((rawName, colIdx) => {
    const name = sanitizeIdent(rawName || `col_${colIdx + 1}`);
    const values = sample.map((r) => r[colIdx] ?? "").filter((v) => v !== "");
    return { name, type: inferType(values) };
  });
  return { columns, fieldDelimiter: delimiter, hasHeader: true };
}

function inferType(samples: string[]): string {
  if (samples.length === 0) return "string";
  if (samples.every(isInteger)) return "bigint";
  if (samples.every(isNumeric)) return "double";
  if (samples.every(isBoolean)) return "boolean";
  if (samples.every(isIsoTimestamp)) return "timestamp";
  return "string";
}

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s);
}

function isNumeric(s: string): boolean {
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s);
}

function isBoolean(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "true" || t === "false";
}

function isIsoTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);
}

function parseCsv(text: string, delimiter: string): string[][] {
  // Chomp trailing partial line — we only got a byte-range, may have split mid-row.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lastNl = normalized.lastIndexOf("\n");
  const safe = lastNl === -1 ? normalized : normalized.slice(0, lastNl);
  const lines = safe.split("\n").filter((l) => l.length > 0);
  return lines.map((line) => parseCsvLine(line, delimiter));
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

// ----------------------------------------------------------------------------

async function ensureDatabase(
  athena: AthenaClient,
  scope: AthenaScope,
  database: string
): Promise<void> {
  const { executionId } = await startQuery(athena, scope, {
    sql: createDatabaseDdl(database),
  });
  const start = Date.now();
  for (;;) {
    const status = await getQuery(athena, executionId);
    if (status.state === "SUCCEEDED") return;
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(
        `CREATE DATABASE failed: ${status.stateChangeReason ?? status.state}`
      );
    }
    if (Date.now() - start > ENSURE_DB_POLL_TIMEOUT_MS) {
      throw new Error("Timed out waiting for CREATE DATABASE to finish");
    }
    await new Promise((r) => setTimeout(r, ENSURE_DB_POLL_INTERVAL_MS));
  }
}
