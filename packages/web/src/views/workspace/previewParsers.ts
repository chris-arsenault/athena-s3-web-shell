import Papa from "papaparse";

import type { ResultColumn } from "@athena-shell/shared";

/**
 * Pure parsing helpers for the preview drawer. Each returns a
 * best-effort result; parse errors become `ParseFailure` so the UI
 * can surface a non-blocking error chip and fall back to raw text.
 */

export interface ParsedTable {
  columns: ResultColumn[];
  rows: string[][];
}

export interface ParseFailure {
  error: string;
}

export type TableResult = ParsedTable | ParseFailure;

const TABLE_ROW_CAP = 200;

export function parseDelimited(text: string, delimiter: string): TableResult {
  const result = Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: true,
    preview: TABLE_ROW_CAP + 1,
  });
  if (result.errors.length > 0 && result.data.length === 0) {
    return { error: result.errors[0]!.message };
  }
  if (result.data.length === 0) {
    return { columns: [], rows: [] };
  }
  const header = result.data[0] ?? [];
  const columns: ResultColumn[] = header.map((name, i) => ({
    name: name || `col_${i + 1}`,
    type: "string",
  }));
  const rows = result.data.slice(1, 1 + TABLE_ROW_CAP);
  return { columns, rows };
}

export function parseJsonLines(text: string): TableResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };
  const records: Record<string, unknown>[] = [];
  for (const line of lines.slice(0, TABLE_ROW_CAP)) {
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        records.push(v as Record<string, unknown>);
      }
    } catch {
      return { error: "malformed JSONL — one of the lines didn't parse" };
    }
  }
  const keys = unionKeys(records);
  const columns: ResultColumn[] = keys.map((k) => ({ name: k, type: "string" }));
  const rows = records.map((r) => keys.map((k) => cellString(r[k])));
  return { columns, rows };
}

function unionKeys(records: readonly Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return keys;
}

function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export type JsonNode =
  | { kind: "obj"; entries: [string, JsonNode][] }
  | { kind: "arr"; items: JsonNode[] }
  | { kind: "str"; value: string }
  | { kind: "num"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "null" };

export type JsonResult = { root: JsonNode } | ParseFailure;

export function parseJsonTree(text: string): JsonResult {
  try {
    return { root: toNode(JSON.parse(text)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function toNode(v: unknown): JsonNode {
  if (v === null) return { kind: "null" };
  if (typeof v === "string") return { kind: "str", value: v };
  if (typeof v === "number") return { kind: "num", value: v };
  if (typeof v === "boolean") return { kind: "bool", value: v };
  if (Array.isArray(v)) return { kind: "arr", items: v.map(toNode) };
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => [k, toNode(val)] as [string, JsonNode]
    );
    return { kind: "obj", entries };
  }
  return { kind: "null" };
}

export function isFailure(r: { error: string } | object): r is ParseFailure {
  return "error" in r && typeof (r as ParseFailure).error === "string";
}
