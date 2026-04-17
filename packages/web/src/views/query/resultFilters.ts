import type { ResultColumn } from "@athena-shell/shared";

/**
 * In-memory filter over already-fetched result rows. Filters compose
 * with AND across columns. Within a column, a cell passes if it matches
 * both the substring search (case-insensitive) and is in the selected
 * distinct-value set (if the set is non-empty).
 *
 * Reminder surfaced by the UI: filters only apply to the rows the
 * caller has already fetched — if `nextToken` exists, there may be
 * more rows upstream that would match.
 */

export interface ColumnFilter {
  values: ReadonlySet<string>;
  search: string;
}

export type FilterState = ReadonlyMap<string, ColumnFilter>;

export const EMPTY_FILTER: ColumnFilter = {
  values: new Set(),
  search: "",
};

export function hasActiveFilters(state: FilterState): boolean {
  for (const f of state.values()) {
    if (f.search || f.values.size > 0) return true;
  }
  return false;
}

export function applyFilters(
  rows: readonly string[][],
  columns: readonly ResultColumn[],
  state: FilterState
): string[][] {
  if (!hasActiveFilters(state)) return rows as string[][];
  const active = collectActive(state, columns);
  if (active.length === 0) return rows as string[][];
  return rows.filter((row) => rowMatches(row, active));
}

function rowMatches(row: string[], active: ResolvedFilter[]): boolean {
  for (const a of active) {
    const cell = row[a.index] ?? "";
    if (a.search && !cell.toLowerCase().includes(a.search)) return false;
    if (a.values.size > 0 && !a.values.has(cell)) return false;
  }
  return true;
}

interface ResolvedFilter {
  index: number;
  values: ReadonlySet<string>;
  search: string;
}

function collectActive(state: FilterState, columns: readonly ResultColumn[]): ResolvedFilter[] {
  const out: ResolvedFilter[] = [];
  for (const [col, filter] of state) {
    if (!filter.search && filter.values.size === 0) continue;
    const idx = columns.findIndex((c) => c.name === col);
    if (idx === -1) continue;
    out.push({ index: idx, values: filter.values, search: filter.search.toLowerCase() });
  }
  return out;
}

export interface DistinctEntry {
  value: string;
  count: number;
}

export function distinctValues(
  rows: readonly string[][],
  columnIndex: number,
  topN = 100
): DistinctEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = row[columnIndex] ?? "";
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const entries = Array.from(counts, ([value, count]) => ({ value, count }));
  entries.sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value));
  return entries.slice(0, topN);
}

export function setColumnSearch(state: FilterState, column: string, search: string): FilterState {
  return merge(state, column, { search });
}

export function setColumnValues(
  state: FilterState,
  column: string,
  values: ReadonlySet<string>
): FilterState {
  return merge(state, column, { values });
}

export function clearColumnFilter(state: FilterState, column: string): FilterState {
  const next = new Map(state);
  next.delete(column);
  return next;
}

export function clearAll(): FilterState {
  return new Map();
}

function merge(state: FilterState, column: string, patch: Partial<ColumnFilter>): FilterState {
  const next = new Map(state);
  const cur = state.get(column) ?? EMPTY_FILTER;
  const updated: ColumnFilter = { ...cur, ...patch };
  if (!updated.search && updated.values.size === 0) {
    next.delete(column);
  } else {
    next.set(column, updated);
  }
  return next;
}
