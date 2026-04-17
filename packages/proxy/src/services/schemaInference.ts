import type { DatasetColumn } from "@athena-shell/shared";
import type { SchemaElement } from "hyparquet";

import { sanitizeIdent } from "./ddlTemplates.js";

/**
 * Pure schema-inference helpers for non-delimited file types. Kept
 * separate from `datasetsService.ts` so tests can hit them without
 * stubbing S3 or Athena clients.
 *
 * Each function returns only primitive-typed columns; nested struct
 * / array types fall through to `string` so the user can hand-edit
 * in the modal if they really want a struct column. Athena does
 * support `struct<…>` but Glue's registration API gets awkward
 * quickly and it's rarely what users actually want for ad-hoc
 * analysis.
 */

const ISO_TS = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferJsonlSchema(text: string, sampleRows: number): DatasetColumn[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const records: Record<string, unknown>[] = [];
  // Malformed lines — including the final partial line of a range-
  // fetched sample — are skipped by the try/catch rather than pre-
  // trimmed, so short complete inputs don't lose their tail record.
  for (const line of lines.slice(0, sampleRows)) {
    try {
      const v = JSON.parse(line);
      if (isRecord(v)) records.push(v);
    } catch {
      // skip malformed line
    }
  }
  return columnsFromRecords(records);
}

export function inferJsonSchema(text: string, sampleRows: number): DatasetColumn[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("json file did not parse as a whole document");
  }
  if (Array.isArray(parsed)) {
    const records = parsed.filter(isRecord).slice(0, sampleRows);
    if (records.length === 0) {
      throw new Error("json array contained no object records to infer from");
    }
    return columnsFromRecords(records);
  }
  if (isRecord(parsed)) return columnsFromRecords([parsed]);
  throw new Error("json was neither an object nor an array of objects");
}

export function parquetSchemaToColumns(schema: SchemaElement[]): DatasetColumn[] {
  const out: DatasetColumn[] = [];
  // schema[0] is the root group; real columns are schema[1..]. We skip
  // nested groups (num_children > 0) rather than try to flatten nested
  // structs — that's a hand-edit case in the modal.
  for (let i = 1; i < schema.length; i++) {
    const el = schema[i]!;
    if (el.num_children && el.num_children > 0) continue;
    if (!el.type) continue;
    out.push({
      name: sanitizeIdent(el.name),
      type: parquetTypeToAthena(el),
    });
  }
  return out;
}

function parquetTypeToAthena(el: SchemaElement): string {
  return logicalTypeToAthena(el) ?? primitiveTypeToAthena(el.type);
}

function logicalTypeToAthena(el: SchemaElement): string | null {
  const logical = el.logical_type?.type;
  if (logical === "TIMESTAMP") return "timestamp";
  if (logical === "DATE") return "date";
  if (logical === "STRING") return "string";
  if (logical === "DECIMAL" && el.precision != null && el.scale != null) {
    return `decimal(${el.precision},${el.scale})`;
  }
  return null;
}

function primitiveTypeToAthena(type: SchemaElement["type"]): string {
  switch (type) {
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
      return "timestamp"; // legacy parquet timestamp encoding
    default:
      return "string"; // BYTE_ARRAY, FIXED_LEN_BYTE_ARRAY, undefined
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
    type: inferTypeFromValues(records.map((r) => r[k])),
  }));
}

function inferTypeFromValues(values: unknown[]): string {
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

/**
 * Extract sample rows from JSONL/JSON text, serialized into string cells
 * in the order of `columns` (matching `columns[i].name`). Missing keys
 * produce an empty string cell. Used by the analyze flow so findings
 * detectors (null-token, type-mismatch) have raw values to inspect.
 */
export function extractJsonlRows(
  text: string,
  columns: DatasetColumn[],
  sampleRows: number
): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: string[][] = [];
  for (const line of lines.slice(0, sampleRows)) {
    try {
      const v = JSON.parse(line);
      if (isRecord(v)) out.push(recordToRow(v, columns));
    } catch {
      // skip
    }
  }
  return out;
}

export function extractJsonRows(
  text: string,
  columns: DatasetColumn[],
  sampleRows: number
): string[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord).slice(0, sampleRows).map((r) => recordToRow(r, columns));
  }
  if (isRecord(parsed)) return [recordToRow(parsed, columns)];
  return [];
}

function recordToRow(rec: Record<string, unknown>, columns: DatasetColumn[]): string[] {
  return columns.map((c) => {
    const v = rec[c.name];
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  });
}
