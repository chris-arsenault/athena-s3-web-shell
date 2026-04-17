import { useEffect, useRef, useState } from "react";

import {
  RESULTS_ROW_CAP,
  type QueryResultPage,
  type QueryStatus,
} from "@athena-shell/shared";

import { EmptyState } from "../../components/EmptyState";
import { VirtualTable } from "../../components/VirtualTable";
import { downloadBlob, resultsToCsv } from "../../utils/csvDownload";
import { formatBytes } from "../../utils/formatBytes";
import { SaveResultModal } from "./SaveResultModal";
import "./ResultsTable.css";

interface Props {
  results: QueryResultPage | null;
  status: QueryStatus | null;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onHeaderFilterClick?: (column: string, anchor: DOMRect) => void;
  activeFilterColumns?: ReadonlySet<string>;
  header?: React.ReactNode;
  draggableHeaders?: boolean;
}

export function ResultsTable(props: Props) {
  const { results, status, loadingMore, onLoadMore } = props;
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
      {props.header}
      <VirtualTable
        rows={results.rows}
        columns={results.columns}
        onHeaderFilterClick={props.onHeaderFilterClick}
        activeFilterColumns={props.activeFilterColumns}
        draggableHeaders={props.draggableHeaders}
      />
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedToast, setSavedToast] = useState<string | null>(null);
  const canSave = status?.state === "SUCCEEDED" && !!status.executionId;
  return (
    <div className="results-meta flex-row gap-4">
      <MetaStats results={results} status={status} />
      <span className="results-id mono text-dim truncate ml-auto">
        {status?.executionId ? `exec · ${status.executionId.slice(0, 10)}` : ""}
      </span>
      <button
        className="btn"
        onClick={() => setSaveOpen(true)}
        disabled={!canSave}
        data-testid="results-save-workspace"
        title="Save result into workspace"
      >
        <span aria-hidden>◆</span>
        <span>save</span>
      </button>
      <button
        className="btn"
        onClick={() =>
          downloadBlob(resultsToCsv(results), `${status?.executionId ?? "results"}.csv`)
        }
      >
        <span aria-hidden>↓</span>
        <span>CSV</span>
      </button>
      {saveOpen && canSave && status && (
        <SaveResultModal
          executionId={status.executionId}
          status={status}
          onClose={() => setSaveOpen(false)}
          onSaved={(key) => {
            setSaveOpen(false);
            setSavedToast(key);
            setTimeout(() => setSavedToast(null), 4_000);
          }}
        />
      )}
      {savedToast && (
        <div className="results-toast mono" data-testid="results-save-toast">
          saved to <span className="text-dim">{savedToast}</span>
        </div>
      )}
    </div>
  );
}

function MetaStats({
  results,
  status,
}: {
  results: QueryResultPage;
  status: QueryStatus | null;
}) {
  return (
    <>
      <Stat label="ROWS" value={results.rows.length} />
      {status?.stats?.dataScannedBytes !== undefined && (
        <Stat label="SCANNED" value={status.stats.dataScannedBytes} format={formatBytes} />
      )}
      {status?.stats?.totalExecutionMs !== undefined && (
        <Stat label="ELAPSED" value={Math.round(status.stats.totalExecutionMs)} suffix=" ms" />
      )}
    </>
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
