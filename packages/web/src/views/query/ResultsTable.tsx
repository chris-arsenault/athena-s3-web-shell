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
        <EmptyState icon="⌘" title="Run a query to see results" />
      </div>
    );
  }
  return (
    <div className="results flex-col flex-1">
      <div className="results-meta flex-row gap-3 text-sm text-muted">
        <span>{results.rows.length} rows</span>
        {status?.stats?.dataScannedBytes !== undefined && (
          <span>{formatBytes(status.stats.dataScannedBytes)} scanned</span>
        )}
        {status?.stats?.totalExecutionMs !== undefined && (
          <span>{Math.round(status.stats.totalExecutionMs)} ms</span>
        )}
        <button
          className="btn btn-ghost ml-auto"
          onClick={() =>
            downloadBlob(resultsToCsv(results), `${status?.executionId ?? "results"}.csv`)
          }
        >
          ⬇ CSV
        </button>
      </div>
      <div className="results-table-wrap flex-1">
        <table className="results-table">
          <thead>
            <tr>
              {results.columns.map((c) => (
                <th key={c.name}>
                  <span>{c.name}</span>
                  <span className="text-muted text-sm">{c.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row, i) => (
              <tr key={i}>
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
