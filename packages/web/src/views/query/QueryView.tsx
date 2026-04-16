import { useCallback, useState } from "react";

import type { HistoryEntry, QueryResultPage, QueryStatus } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { getResults, stopQuery } from "../../data/queryRepo";
import { SchemaProvider } from "../../data/schemaContext";
import { HistoryPanel } from "./HistoryPanel";
import { QueryToolbar } from "./QueryToolbar";
import { ResultsTable } from "./ResultsTable";
import { SchemaTree } from "./SchemaTree";
import { SqlEditor } from "./SqlEditor";
import { useQueryRunner } from "./useQueryRunner";
import "./QueryView.css";

export function QueryView() {
  return (
    <SchemaProvider>
      <QueryViewInner />
    </SchemaProvider>
  );
}

function QueryViewInner() {
  const { provider, context, loading } = useAuth();
  const [sql, setSql] = useState("SELECT 1 AS hello");
  const [status, setStatus] = useState<QueryStatus | null>(null);
  const [results, setResults] = useState<QueryResultPage | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const runner = useQueryRunner({
    provider,
    sql,
    onStatus: setStatus,
    onResults: setResults,
    onError: setError,
  });

  const onLoadFromHistory = useCallback((entry: HistoryEntry) => {
    setSql(entry.sql);
    setStatus(null);
    setResults(null);
  }, []);

  const onStop = useCallback(async () => {
    if (!status) return;
    await stopQuery(provider, status.executionId);
  }, [provider, status]);

  const onLoadMore = useCallback(async () => {
    const execId = status?.executionId;
    const token = results?.nextToken;
    if (!execId || !token) return;
    setLoadingMore(true);
    try {
      const next = await getResults(provider, execId, token);
      setResults((prev) =>
        prev
          ? {
              columns: prev.columns,
              rows: [...prev.rows, ...next.rows],
              nextToken: next.nextToken,
            }
          : next
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoadingMore(false);
    }
  }, [provider, status?.executionId, results?.nextToken]);

  if (loading || !context) return <LoadingSpinner label="query workspace" />;

  return (
    <div className="query-view flex-row flex-1">
      <aside className="query-side">
        <SchemaTree />
      </aside>
      <section className="query-main flex-col flex-1">
        <QueryToolbar
          status={status?.state ?? "idle"}
          isRunning={runner.isRunning}
          onRun={runner.run}
          onStop={onStop}
        />
        <div className="query-editor">
          <SqlEditor value={sql} onChange={setSql} />
        </div>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        <ResultsTable
          results={results}
          status={status}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
        />
      </section>
      <aside className="query-history">
        <HistoryPanel onSelect={onLoadFromHistory} refreshKey={status?.executionId ?? ""} />
      </aside>
    </div>
  );
}
