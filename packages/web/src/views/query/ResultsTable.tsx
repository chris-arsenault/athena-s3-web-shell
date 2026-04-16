import { useEffect, useRef, useState } from "react";

import type { QueryResultPage, QueryStatus } from "@athena-shell/shared";

import { EmptyState } from "../../components/EmptyState";
import { downloadBlob, resultsToCsv } from "../../utils/csvDownload";
import { formatBytes } from "../../utils/formatBytes";
import "./ResultsTable.css";

interface Props {
  results: QueryResultPage | null;
  status: QueryStatus | null;
}

export function ResultsTable({ results, status }: Props) {
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
  return (
    <div className="results flex-col flex-1">
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
      <div className="results-table-wrap flex-1">
        <table className="results-table">
          <thead>
            <tr>
              {results.columns.map((c) => (
                <th key={c.name}>
                  <div className="th-inner">
                    <span className="th-name">{c.name}</span>
                    <span className="th-type">{c.type}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row, i) => (
              <tr key={i}>
                <td className="td-idx mono">{String(i + 1).padStart(3, "0")}</td>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
