import type { QueryResultPage, ResultColumn } from "@athena-shell/shared";

/**
 * Pure in-memory aggregation over already-fetched result rows. Produces
 * a replacement {columns, rows} shaped like a `QueryResultPage` so the
 * existing virtualized table can render it without modification.
 *
 * Athena returns every cell as a string. Numeric aggregations parse on
 * the fly and skip cells that don't parse cleanly; COUNT semantics
 * match SQL (null/empty excluded for `COUNT(col)`, included for `COUNT(*)`
 * — we model `*` as a dedicated sentinel column name).
 */

export type AggOp = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "COUNT_DISTINCT";

export interface Aggregation {
  column: string;
  op: AggOp;
}

export interface GroupBySpec {
  groupBy: string[];
  aggregations: Aggregation[];
}

const NUMERIC_TYPES = new Set([
  "tinyint",
  "smallint",
  "integer",
  "int",
  "bigint",
  "float",
  "double",
  "decimal",
  "real",
  "numeric",
]);

export function isNumericColumn(c: ResultColumn): boolean {
  return NUMERIC_TYPES.has(c.type.toLowerCase().replace(/\(.*$/, ""));
}

export function allowedAggregations(c: ResultColumn): AggOp[] {
  const base: AggOp[] = ["COUNT", "COUNT_DISTINCT"];
  if (isNumericColumn(c)) return [...base, "SUM", "AVG", "MIN", "MAX"];
  return base;
}

export function aggregate(
  rows: readonly string[][],
  columns: readonly ResultColumn[],
  spec: GroupBySpec
): QueryResultPage {
  const groupIdx = spec.groupBy.map((name) => indexOfColumn(columns, name));
  const aggIdx = spec.aggregations.map((a) => ({
    op: a.op,
    column: a.column,
    index: indexOfColumn(columns, a.column),
  }));

  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const key = groupIdx.map((i) => row[i] ?? "").join("\u0000");
    const bucket = groups.get(key) ?? [];
    if (!groups.has(key)) groups.set(key, bucket);
    bucket.push(row);
  }

  const outColumns: ResultColumn[] = [
    ...spec.groupBy.map((name) => cloneCol(columns, name)),
    ...aggIdx.map((a) => ({ name: aggLabel(a.column, a.op), type: aggType(a.op) })),
  ];

  const outRows: string[][] = [];
  for (const [key, bucket] of groups) {
    const groupValues = key.split("\u0000");
    const aggValues = aggIdx.map((a) => computeAgg(bucket, a.index, a.op));
    outRows.push([...groupValues, ...aggValues]);
  }
  return { columns: outColumns, rows: outRows };
}

function indexOfColumn(columns: readonly ResultColumn[], name: string): number {
  const idx = columns.findIndex((c) => c.name === name);
  if (idx === -1) throw new Error(`Unknown column: ${name}`);
  return idx;
}

function cloneCol(columns: readonly ResultColumn[], name: string): ResultColumn {
  const c = columns[indexOfColumn(columns, name)]!;
  return { name: c.name, type: c.type };
}

function aggLabel(column: string, op: AggOp): string {
  if (op === "COUNT_DISTINCT") return `count_distinct_${column}`;
  return `${op.toLowerCase()}_${column}`;
}

function aggType(op: AggOp): string {
  if (op === "COUNT" || op === "COUNT_DISTINCT") return "bigint";
  if (op === "SUM" || op === "AVG") return "double";
  return "varchar";
}

function computeAgg(bucket: string[][], index: number, op: AggOp): string {
  if (op === "COUNT") return String(countNonEmpty(bucket, index));
  if (op === "COUNT_DISTINCT") return String(countDistinct(bucket, index));
  const nums = numericCells(bucket, index);
  if (nums.length === 0) return "";
  if (op === "SUM") return String(nums.reduce((a, b) => a + b, 0));
  if (op === "AVG") return String(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (op === "MIN") return String(Math.min(...nums));
  if (op === "MAX") return String(Math.max(...nums));
  return "";
}

function countNonEmpty(bucket: string[][], index: number): number {
  let n = 0;
  for (const row of bucket) if ((row[index] ?? "") !== "") n += 1;
  return n;
}

function countDistinct(bucket: string[][], index: number): number {
  const seen = new Set<string>();
  for (const row of bucket) {
    const v = row[index] ?? "";
    if (v !== "") seen.add(v);
  }
  return seen.size;
}

function numericCells(bucket: string[][], index: number): number[] {
  const out: number[] = [];
  for (const row of bucket) {
    const raw = row[index];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}
