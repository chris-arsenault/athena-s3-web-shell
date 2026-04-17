import { useCallback, useMemo, useState } from "react";

import type { QueryResultPage } from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { fetchAllResultsDirect, getResults } from "../../data/queryRepo";
import { splitStatements, statementAtOffset } from "./splitStatements";
import { useRunQueue, type QueueItem } from "./useRunQueue";

interface Args {
  provider: AuthProvider;
  initialSql?: string;
}

export function useQueryViewState({ provider, initialSql = "SELECT 1 AS hello" }: Args) {
  const [sql, setSql] = useState(initialSql);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedKey, setSavedKey] = useState(0);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [paginatedResults, setPaginatedResults] = useState<QueryResultPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const runQueue = useRunQueue({ provider, stopOnFailure });
  const runners = useRunners(runQueue, sql, setSql, setPaginatedResults);
  const selected = useMemo(
    () => findSelected(runQueue.queue, runQueue.selectedId),
    [runQueue.queue, runQueue.selectedId]
  );
  const selectQueueItem = useCallback(
    (id: string) => {
      runQueue.setSelectedId(id);
      setPaginatedResults(null);
    },
    [runQueue]
  );
  const onLoadMore = useCallback(
    () => loadMore({ provider, selected, paginatedResults, setPaginatedResults, setLoadingMore }),
    [provider, selected, paginatedResults]
  );

  const displayResults = paginatedResults ?? selected?.results ?? null;
  const displayStatus = selected?.status ?? null;
  const displayStateLabel = displayStatus?.state ?? "idle";
  const canSave = sql.trim().length > 0 && !runQueue.isRunning;

  return {
    sql,
    setSql,
    saveOpen,
    setSaveOpen,
    savedKey,
    bumpSavedKey: () => setSavedKey((k) => k + 1),
    stopOnFailure,
    toggleStopOnFailure: () => setStopOnFailure((v) => !v),
    runQueue,
    selected,
    paginatedResults,
    loadingMore,
    displayResults,
    displayStatus,
    displayStateLabel,
    canSave,
    ...runners,
    selectQueueItem,
    onLoadMore,
  };
}

type Runner = ReturnType<typeof useRunQueue>;

function useRunners(
  runQueue: Runner,
  sql: string,
  setSql: (s: string) => void,
  resetPagination: (r: QueryResultPage | null) => void
) {
  const replaceSql = useCallback(
    (next: string) => {
      setSql(next);
      resetPagination(null);
      runQueue.clear();
    },
    [runQueue, setSql, resetPagination]
  );
  const runAll = useCallback(() => {
    resetPagination(null);
    runQueue.runAll(splitStatements(sql).map((s) => s.text));
  }, [runQueue, sql, resetPagination]);
  const runAtCursor = useCallback(
    (offset: number) => {
      const stmt = statementAtOffset(splitStatements(sql), offset);
      if (!stmt) return;
      resetPagination(null);
      runQueue.runAll([stmt.text]);
    },
    [runQueue, sql, resetPagination]
  );
  const runSelection = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      resetPagination(null);
      runQueue.runAll([trimmed]);
    },
    [runQueue, resetPagination]
  );
  return { replaceSql, runAll, runAtCursor, runSelection };
}

export function findSelected(queue: QueueItem[], id: string | null): QueueItem | null {
  if (!id) return null;
  return queue.find((it) => it.id === id) ?? null;
}

export function selectedError(selected: QueueItem | null): Error | null {
  if (!selected) return null;
  if (selected.state === "failed" && selected.error) return selected.error;
  return null;
}

interface LoadMoreArgs {
  provider: AuthProvider;
  selected: QueueItem | null;
  paginatedResults: QueryResultPage | null;
  setPaginatedResults: (r: QueryResultPage | null) => void;
  setLoadingMore: (b: boolean) => void;
}

async function loadMore(args: LoadMoreArgs): Promise<void> {
  const { provider, selected, paginatedResults, setPaginatedResults, setLoadingMore } = args;
  const base = paginatedResults ?? selected?.results ?? null;
  const execId = selected?.executionId;
  const token = base?.nextToken;
  if (!execId || !token || !base) return;
  setLoadingMore(true);
  try {
    // First "load more" click: switch to direct-from-S3 fetch to pull
    // the full result set in one shot (bypasses GetQueryResults's 1k
    // page size — typically 50-100× faster for bulk reads). Subsequent
    // paginatedResults will have no nextToken so this branch only runs
    // once per execution.
    const full = await fetchAllResultsDirect(provider, execId, base);
    if (full) {
      setPaginatedResults(full);
    } else {
      const next = await getResults(provider, execId, token);
      setPaginatedResults({
        columns: base.columns,
        rows: [...base.rows, ...next.rows],
        nextToken: next.nextToken,
      });
    }
  } finally {
    setLoadingMore(false);
  }
}
