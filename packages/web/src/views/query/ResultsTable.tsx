import { useEffect, useRef, useState } from "react";

import {
  RESULTS_ROW_CAP,
  type QueryResultPage,
  type QueryStatus,
  type ResultColumn,
} from "@athena-shell/shared";

import { EmptyState } from "../../components/EmptyState";
import { downloadBlob, resultsToCsv } from "../../utils/csvDownload";
import { formatBytes } from "../../utils/formatBytes";
import "./ResultsTable.css";

interface Props {
  results: QueryResultPage | null;
  status: QueryStatus | null;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

export function ResultsTable({ results, status, loadingMore, onLoadMore }: Props) {
  if (!results) {
    return (
      <div className="results-empty">
        <EmptyState
          icon="⌘"
          title="Awaiting execution."
          hint="Compose a statement above and press ⌘↵ to dispatch against Athena."
        />
      </div>
    );
  }
  const atCap = results.rows.length >= RESULTS_ROW_CAP;
  const hasMore = !!results.nextToken && !atCap;
  return (
    <div className="results flex-col flex-1">
      <ResultsMeta results={results} status={status} />
      <VirtualTable rows={results.rows} columns={results.columns} />
      <ResultsFoot
        rowCount={results.rows.length}
        hasMore={hasMore}
        atCap={atCap}
        loadingMore={!!loadingMore}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}

function ResultsMeta({
  results,
  status,
}: {
  results: QueryResultPage;
  status: QueryStatus | null;
}) {
  return (
    <div className="results-meta flex-row gap-4">
      <Stat label="ROWS" value={results.rows.length} />
      {status?.stats?.dataScannedBytes !== undefined && (
        <Stat
          label="SCANNED"
          value={status.stats.dataScannedBytes}
          format={formatBytes}
        />
      )}
      {status?.stats?.totalExecutionMs !== undefined && (
        <Stat
          label="ELAPSED"
          value={Math.round(status.stats.totalExecutionMs)}
          suffix=" ms"
        />
      )}
      <span className="results-id mono text-dim truncate ml-auto">
        {status?.executionId ? `exec · ${status.executionId.slice(0, 10)}` : ""}
      </span>
      <button
        className="btn"
        onClick={() =>
          downloadBlob(resultsToCsv(results), `${status?.executionId ?? "results"}.csv`)
        }
      >
        <span aria-hidden>↓</span>
        <span>CSV</span>
      </button>
    </div>
  );
}

function ResultsFoot({
  rowCount,
  hasMore,
  atCap,
  loadingMore,
  onLoadMore,
}: {
  rowCount: number;
  hasMore: boolean;
  atCap: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
}) {
  if (atCap) {
    return (
      <div className="results-foot results-foot-cap flex-row gap-2">
        <span className="tok tok-warn">cap</span>
        <span className="mono">
          showing first {rowCount.toLocaleString()} rows · download the CSV for the
          full set
        </span>
      </div>
    );
  }
  if (!hasMore) return null;
  return (
    <div className="results-foot flex-row gap-3">
      <span className="tracked text-dim">more rows available</span>
      <button
        className="btn"
        onClick={onLoadMore}
        disabled={loadingMore}
      >
        {loadingMore ? "loading…" : "load more"}
      </button>
    </div>
  );
}

// ── Virtualized body ─────────────────────────────────────────────
// Hand-rolled windowing — no react-window dep. Each row is a fixed-height
// grid row; body is position:relative with a total-height sizer so only the
// visible rows + overscan are mounted.

const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 10;
const DEFAULT_VIEWPORT = 480;

interface VirtualTableProps {
  columns: ResultColumn[];
  rows: string[][];
}

function VirtualTable({ columns, rows }: VirtualTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewportHeight(el.clientHeight || DEFAULT_VIEWPORT);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = rows.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastExclusive = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
  );
  const visible = rows.slice(first, lastExclusive);

  const gridTemplate = `48px ${columns.map(() => "minmax(120px, 1fr)").join(" ")}`;

  return (
    <div
      ref={scrollRef}
      className="vt-scroll"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* eslint-disable-next-line local/no-inline-styles */}
      <div className="vt-head" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="vt-th vt-th-idx" />
        {columns.map((c) => (
          <div key={c.name} className="vt-th">
            <span className="vt-th-name">{c.name}</span>
            <span className="vt-th-type">{c.type}</span>
          </div>
        ))}
      </div>
      {/* eslint-disable-next-line local/no-inline-styles */}
      <div className="vt-body" style={{ height: total * ROW_HEIGHT }}>
        {visible.map((row, i) => {
          const absoluteIndex = first + i;
          return (
            <div
              key={absoluteIndex}
              className="vt-row"
              /* eslint-disable-next-line local/no-inline-styles */
              style={{
                top: absoluteIndex * ROW_HEIGHT,
                gridTemplateColumns: gridTemplate,
              }}
            >
              <div className="vt-cell vt-cell-idx mono">
                {String(absoluteIndex + 1).padStart(3, "0")}
              </div>
              {row.map((cell, j) => (
                <div key={j} className="vt-cell">
                  {cell}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  format?: (n: number) => string;
  suffix?: string;
}

function Stat({ label, value, format, suffix }: StatProps) {
  const display = useCountUp(value);
  const shown = format ? format(display) : display.toLocaleString();
  return (
    <div className="stat flex-col">
      <span className="stat-value serif tnum">
        {shown}
        {suffix && <span className="stat-suffix mono">{suffix}</span>}
      </span>
      <span className="stat-label tracked">{label}</span>
    </div>
  );
}

function useCountUp(target: number): number {
  const [display, setDisplay] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);

  useEffect(() => {
    fromRef.current = 0;
    startRef.current = null;
    let raf = 0;
    const duration = 620;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(p < 1 ? Math.round(next) : target);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return display;
}
