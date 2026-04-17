import { useEffect, useMemo, useState } from "react";

import type { QueryResultPage, QueryStatus } from "@athena-shell/shared";

import { ColumnFilterPopover } from "./ColumnFilterPopover";
import { GroupByPanel } from "./GroupByPanel";
import { ResultsTable } from "./ResultsTable";
import {
  aggregate,
  type GroupBySpec,
} from "./resultAggregations";
import {
  applyFilters,
  clearAll,
  clearColumnFilter,
  EMPTY_FILTER,
  hasActiveFilters,
  setColumnValues,
  setColumnSearch,
  type ColumnFilter,
  type FilterState,
} from "./resultFilters";
import "./ResultsPane.css";

interface Props {
  results: QueryResultPage | null;
  status: QueryStatus | null;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

const EMPTY_GROUP: GroupBySpec = { groupBy: [], aggregations: [] };

export function ResultsPane(props: Props) {
  const { results, status } = props;
  const execId = status?.executionId ?? null;
  const [filters, setFilters] = useState<FilterState>(() => new Map());
  const [groupBy, setGroupBy] = useState<GroupBySpec | null>(null);
  const [popover, setPopover] = useState<{ column: string; anchor: DOMRect } | null>(null);

  useEffect(() => {
    setFilters(clearAll());
    setGroupBy(null);
    setPopover(null);
  }, [execId]);

  const filteredRows = useMemo(
    () => (results ? applyFilters(results.rows, results.columns, filters) : []),
    [results, filters]
  );
  const effective = useMemo(
    () => effectiveResults(results, filteredRows, groupBy),
    [results, filteredRows, groupBy]
  );
  const activeColumns = useMemo(() => activeSet(filters), [filters]);
  const filtering = hasActiveFilters(filters);

  return (
    <div className="rpane flex-col flex-1">
      {groupBy && results && (
        <GroupByPanel
          columns={results.columns}
          spec={groupBy}
          onChange={setGroupBy}
          onClose={() => setGroupBy(null)}
        />
      )}
      <ResultsTable
        {...props}
        results={effective}
        onHeaderFilterClick={(column, anchor) => setPopover({ column, anchor })}
        activeFilterColumns={activeColumns}
        draggableHeaders={groupBy !== null}
        header={
          <ResultsToolbar
            filtering={filtering}
            groupBy={groupBy}
            filters={filters}
            filteredRowCount={filteredRows.length}
            totalRowCount={results?.rows.length ?? 0}
            hasMoreUpstream={!!results?.nextToken}
            onToggleGroup={() =>
              setGroupBy((g) => (g === null ? EMPTY_GROUP : null))
            }
            onClearFilter={(col) => setFilters((s) => clearColumnFilter(s, col))}
            onClearAll={() => setFilters(clearAll())}
          />
        }
      />
      <MaybePopover
        popover={popover}
        results={results}
        filters={filters}
        setFilters={setFilters}
        onClose={() => setPopover(null)}
      />
    </div>
  );
}

interface PopoverProps {
  popover: { column: string; anchor: DOMRect } | null;
  results: QueryResultPage | null;
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onClose: () => void;
}

function MaybePopover({ popover, results, filters, setFilters, onClose }: PopoverProps) {
  if (!popover || !results) return null;
  const col = results.columns.find((c) => c.name === popover.column);
  if (!col) return null;
  return (
    <ColumnFilterPopover
      column={col}
      columnIndex={results.columns.findIndex((c) => c.name === popover.column)}
      rows={results.rows}
      filter={filters.get(popover.column) ?? EMPTY_FILTER}
      onChange={(next) => setFilters((s) => applyColumnPatch(s, popover.column, next))}
      onClose={onClose}
      anchor={popover.anchor}
    />
  );
}

function effectiveResults(
  results: QueryResultPage | null,
  filteredRows: string[][],
  groupBy: GroupBySpec | null
): QueryResultPage | null {
  if (!results) return null;
  if (groupBy && (groupBy.groupBy.length > 0 || groupBy.aggregations.length > 0)) {
    return aggregate(filteredRows, results.columns, groupBy);
  }
  return { columns: results.columns, rows: filteredRows, nextToken: results.nextToken };
}

function activeSet(state: FilterState): Set<string> {
  const out = new Set<string>();
  for (const [col, f] of state) {
    if (f.search || f.values.size > 0) out.add(col);
  }
  return out;
}

function applyColumnPatch(state: FilterState, column: string, next: ColumnFilter): FilterState {
  let s = setColumnSearch(state, column, next.search);
  s = setColumnValues(s, column, next.values);
  return s;
}

interface ToolbarProps {
  filtering: boolean;
  groupBy: GroupBySpec | null;
  filters: FilterState;
  filteredRowCount: number;
  totalRowCount: number;
  hasMoreUpstream: boolean;
  onToggleGroup: () => void;
  onClearFilter: (column: string) => void;
  onClearAll: () => void;
}

function ResultsToolbar(p: ToolbarProps) {
  const chips = chipsFor(p.filters);
  const showBanner =
    p.filtering && p.hasMoreUpstream && p.filteredRowCount < p.totalRowCount;
  if (chips.length === 0 && p.groupBy === null && !showBanner) {
    return (
      <div className="rpane-bar rpane-bar-slim">
        <GroupByToggle active={p.groupBy !== null} onClick={p.onToggleGroup} />
      </div>
    );
  }
  return (
    <div className="rpane-bar flex-row gap-2">
      <GroupByToggle active={p.groupBy !== null} onClick={p.onToggleGroup} />
      {chips.length > 0 && (
        <div className="rpane-chips flex-row gap-1" data-testid="filter-chips">
          {chips.map((c) => (
            <FilterChip
              key={c.column}
              label={c.label}
              onRemove={() => p.onClearFilter(c.column)}
            />
          ))}
          <button
            className="rpane-chip-clear mono"
            onClick={p.onClearAll}
            data-testid="filter-clear-all"
          >
            clear all
          </button>
        </div>
      )}
      {showBanner && (
        <span className="rpane-banner mono text-muted" data-testid="filter-banner">
          filter applies to {p.filteredRowCount.toLocaleString()} of{" "}
          {p.totalRowCount.toLocaleString()} — load more for full set
        </span>
      )}
    </div>
  );
}

function GroupByToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      className={`btn rpane-gb ${active ? "is-active" : ""}`}
      onClick={onClick}
      data-testid="groupby-toggle"
    >
      <span aria-hidden>▦</span>
      <span>group by</span>
    </button>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="rpane-chip mono" data-testid={`filter-chip-${label}`}>
      <span>{label}</span>
      <button className="rpane-chip-x" onClick={onRemove} aria-label={`clear ${label}`}>
        ×
      </button>
    </span>
  );
}

function chipsFor(state: FilterState): { column: string; label: string }[] {
  const chips: { column: string; label: string }[] = [];
  for (const [col, f] of state) {
    if (f.search) chips.push({ column: col, label: `${col} ~ "${f.search}"` });
    if (f.values.size > 0) {
      chips.push({ column: col, label: `${col} in [${[...f.values].slice(0, 3).join(", ")}]` });
    }
  }
  return chips;
}
