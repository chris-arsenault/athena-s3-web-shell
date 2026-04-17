import { useState } from "react";

import type {
  HistoryEntry,
  QueryResultPage,
  QueryStatus,
  SavedQuery,
} from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { getResults, stopQuery } from "../../data/queryRepo";
import { SchemaProvider } from "../../data/schemaContext";
import { HistoryPanel } from "./HistoryPanel";
import { QueryToolbar } from "./QueryToolbar";
import { ResultsTable } from "./ResultsTable";
import { SaveQueryModal } from "./SaveQueryModal";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedKey, setSavedKey] = useState(0);
  const runner = useQueryRunner({
    provider,
    sql,
    onStatus: setStatus,
    onResults: setResults,
    onError: setError,
  });

  const replaceSql = (next: string) => {
    setSql(next);
    setStatus(null);
    setResults(null);
  };
  const onStop = async () => {
    if (status) await stopQuery(provider, status.executionId);
  };
  const onLoadMore = () =>
    loadMore({ provider, status, results, setResults, setError, setLoadingMore });
  const onSaved = () => {
    setSaveOpen(false);
    setSavedKey((k) => k + 1);
  };

  if (loading || !context) return <LoadingSpinner label="query workspace" />;

  return (
    <div className="query-view flex-row flex-1">
      <aside className="query-side flex-col">
        <SchemaTree />
        <SavedQueriesPanel
          refreshKey={savedKey}
          onPick={(q: SavedQuery) => replaceSql(q.sql)}
          onChanged={() => setSavedKey((k) => k + 1)}
        />
      </aside>
      <section className="query-main flex-col flex-1">
        <QueryToolbar
          status={status?.state ?? "idle"}
          isRunning={runner.isRunning}
          onRun={runner.run}
          onStop={onStop}
          onSave={() => setSaveOpen(true)}
          canSave={sql.trim().length > 0 && !runner.isRunning}
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
        <HistoryPanel
          onSelect={(e: HistoryEntry) => replaceSql(e.sql)}
          refreshKey={status?.executionId ?? ""}
        />
      </aside>
      {saveOpen && (
        <SaveQueryModal sql={sql} onClose={() => setSaveOpen(false)} onSaved={onSaved} />
      )}
    </div>
  );
}

interface LoadMoreArgs {
  provider: ReturnType<typeof useAuth>["provider"];
  status: QueryStatus | null;
  results: QueryResultPage | null;
  setResults: (r: QueryResultPage | ((p: QueryResultPage | null) => QueryResultPage)) => void;
  setError: (e: Error | null) => void;
  setLoadingMore: (b: boolean) => void;
}

async function loadMore({
  provider,
  status,
  results,
  setResults,
  setError,
  setLoadingMore,
}: LoadMoreArgs): Promise<void> {
  const execId = status?.executionId;
  const token = results?.nextToken;
  if (!execId || !token) return;
  setLoadingMore(true);
  try {
    const next = await getResults(provider, execId, token);
    setResults((prev) =>
      prev
        ? { columns: prev.columns, rows: [...prev.rows, ...next.rows], nextToken: next.nextToken }
        : next
    );
  } catch (e) {
    setError(e as Error);
  } finally {
    setLoadingMore(false);
  }
}
