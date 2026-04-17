import {
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { parquetMetadataAsync } from "hyparquet";

import type {
  DatasetColumn,
  DatasetFileType,
  InferSchemaResponse,
} from "@athena-shell/shared";

import { sanitizeIdent } from "./ddlTemplates.js";
import {
  extractJsonRows,
  extractJsonlRows,
  inferJsonSchema,
  inferJsonlSchema,
  parquetSchemaToColumns,
} from "./schemaInference.js";

// Re-exported from createTableService for backward import paths.
export { createTable, createTableFromPlan } from "./createTableService.js";

export const DEFAULT_SAMPLE_BYTES = 65536;
export const SAMPLE_DATA_ROWS = 50;

export async function inferSchema(
  s3: S3Client,
  bucket: string,
  key: string,
  fileType: DatasetFileType,
  sampleBytes: number = DEFAULT_SAMPLE_BYTES
): Promise<InferSchemaResponse> {
  if (fileType === "parquet") {
    const columns = await inferParquetSchema(s3, bucket, key);
    return { columns, sampleRows: [], hasHeader: false };
  }
  const text = await fetchSampleText(s3, bucket, key, sampleBytes);
  return inferSchemaFromText(text, fileType);
}

/**
 * Pure variant — works off already-fetched sample text so callers
 * (analyzeService) can share one S3 round-trip across inference and
 * findings detection.
 */
export function inferSchemaFromText(
  text: string,
  fileType: DatasetFileType
): InferSchemaResponse {
  if (fileType === "csv" || fileType === "tsv") {
    const delimiter = fileType === "tsv" ? "\t" : ",";
    return inferCsvSchema(text, delimiter);
  }
  if (fileType === "jsonl") {
    const columns = inferJsonlSchema(text, SAMPLE_DATA_ROWS);
    const sampleRows = extractJsonlRows(text, columns, SAMPLE_DATA_ROWS);
    return { columns, sampleRows, hasHeader: false };
  }
  if (fileType === "json") {
    try {
      const columns = inferJsonSchema(text, SAMPLE_DATA_ROWS);
      const sampleRows = extractJsonRows(text, columns, SAMPLE_DATA_ROWS);
      return { columns, sampleRows, hasHeader: false };
    } catch {
      return { columns: [], sampleRows: [], hasHeader: false };
    }
  }
  return { columns: [], sampleRows: [], hasHeader: false };
}

export async function fetchSampleText(
  s3: S3Client,
  bucket: string,
  key: string,
  bytes: number
): Promise<string> {
  return fetchSample(s3, bucket, key, bytes);
}

// ----------------------------------------------------------------------------

async function inferParquetSchema(
  s3: S3Client,
  bucket: string,
  key: string
): Promise<DatasetColumn[]> {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const byteLength = head.ContentLength ?? 0;
  if (!byteLength) throw new Error(`parquet object has no content-length: ${key}`);
  const asyncBuffer = {
    byteLength,
    async slice(start: number, end: number = byteLength): Promise<ArrayBuffer> {
      return getObjectRangeBuffer(s3, bucket, key, start, end);
    },
  };
  const md = await parquetMetadataAsync(asyncBuffer);
  return parquetSchemaToColumns(md.schema);
}

async function getObjectRangeBuffer(
  s3: S3Client,
  bucket: string,
  key: string,
  start: number,
  endExclusive: number
): Promise<ArrayBuffer> {
  const out = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=${start}-${endExclusive - 1}`,
    })
  );
  if (!out.Body) throw new Error(`No body on range get for s3://${bucket}/${key}`);
  const arr = await out.Body.transformToByteArray();
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

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
  if (rows.length === 0) {
    return { columns: [], sampleRows: [], fieldDelimiter: delimiter, hasHeader: false };
  }
  const header = rows[0]!;
  const sample = rows.slice(1, 1 + SAMPLE_DATA_ROWS);
  const columns: DatasetColumn[] = header.map((rawName, colIdx) => {
    const name = sanitizeIdent(rawName || `col_${colIdx + 1}`);
    const values = sample.map((r) => r[colIdx] ?? "").filter((v) => v !== "");
    return { name, type: inferType(values) };
  });
  return { columns, sampleRows: sample, fieldDelimiter: delimiter, hasHeader: true };
}

function inferType(samples: string[]): string {
  if (samples.length === 0) return "string";
  if (samples.every(isInteger)) return "bigint";
  if (samples.every(isNumeric)) return "double";
  if (samples.every(isBoolean)) return "boolean";
  // DATE vs TIMESTAMP split matters because LazySimpleSerDe's default
  // timestamp format requires a time component — a DATE-typed column
  // lets plain "yyyy-MM-dd" rows parse natively.
  if (samples.every(isIsoDate)) return "date";
  if (samples.every((s) => isIsoDate(s) || isIsoTimestamp(s))) return "timestamp";
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

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isIsoTimestamp(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s);
}

function parseCsv(text: string, delimiter: string): string[][] {
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
