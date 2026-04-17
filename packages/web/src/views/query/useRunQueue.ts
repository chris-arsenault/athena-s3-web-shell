import { useCallback, useRef, useState } from "react";

import {
  QUERY_POLL_INTERVAL_MS,
  QUERY_POLL_TIMEOUT_MS,
  type QueryResultPage,
  type QueryStatus,
} from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { getQuery, getResults, startQuery, stopQuery } from "../../data/queryRepo";

export type QueueItemState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface QueueItem {
  id: string;
  sql: string;
  state: QueueItemState;
  executionId?: string;
  status?: QueryStatus;
  results?: QueryResultPage;
  error?: Error;
}

interface Opts {
  provider: AuthProvider;
  stopOnFailure: boolean;
}

const TERMINAL = new Set<QueryStatus["state"]>(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function useRunQueue({ provider, stopOnFailure }: Opts) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const cancelRef = useRef(false);
  const runningItemRef = useRef<QueueItem | null>(null);

  const patch = useCallback((id: string, p: Partial<QueueItem>) => {
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }, []);

  const runAll = useCallback(
    async (sqls: string[]) => {
      const items = sqls.map((sql) => ({ id: newId(), sql, state: "pending" as const }));
      setQueue(items);
      setSelectedId(items[0]?.id ?? null);
      if (items.length === 0) return;
      cancelRef.current = false;
      setIsRunning(true);
      try {
        for (const it of items) {
          if (cancelRef.current) break;
          runningItemRef.current = it;
          const ok = await runOne(provider, it, patch, setSelectedId);
          if (!ok && stopOnFailure) break;
        }
        if (cancelRef.current) markSkipped(setQueue);
      } finally {
        runningItemRef.current = null;
        setIsRunning(false);
      }
    },
    [provider, stopOnFailure, patch]
  );

  const stop = useCallback(async () => {
    cancelRef.current = true;
    const running = runningItemRef.current;
    if (running?.executionId) await stopQuery(provider, running.executionId);
  }, [provider]);

  const clear = useCallback(() => {
    setQueue([]);
    setSelectedId(null);
  }, []);

  return { queue, selectedId, setSelectedId, isRunning, runAll, stop, clear };
}

async function runOne(
  provider: AuthProvider,
  item: QueueItem,
  patch: (id: string, p: Partial<QueueItem>) => void,
  setSelected: (id: string) => void
): Promise<boolean> {
  patch(item.id, { state: "running" });
  setSelected(item.id);
  try {
    const { executionId } = await startQuery(provider, { sql: item.sql });
    item.executionId = executionId;
    patch(item.id, { executionId });
    return await pollToCompletion(provider, item, patch);
  } catch (e) {
    patch(item.id, { state: "failed", error: e as Error });
    return false;
  }
}

async function pollToCompletion(
  provider: AuthProvider,
  item: QueueItem,
  patch: (id: string, p: Partial<QueueItem>) => void
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    const status = await getQuery(provider, item.executionId!);
    patch(item.id, { status });
    if (TERMINAL.has(status.state)) return finalize(provider, item, status, patch);
    if (Date.now() - start > QUERY_POLL_TIMEOUT_MS) {
      patch(item.id, { state: "failed", error: new Error("polling timeout") });
      return false;
    }
    await sleep(QUERY_POLL_INTERVAL_MS);
  }
}

async function finalize(
  provider: AuthProvider,
  item: QueueItem,
  status: QueryStatus,
  patch: (id: string, p: Partial<QueueItem>) => void
): Promise<boolean> {
  if (status.state === "SUCCEEDED") {
    const results = await getResults(provider, item.executionId!);
    patch(item.id, { state: "succeeded", results });
    return true;
  }
  if (status.state === "CANCELLED") {
    patch(item.id, { state: "cancelled" });
    return false;
  }
  patch(item.id, {
    state: "failed",
    error: new Error(status.stateChangeReason ?? "query failed"),
  });
  return false;
}

function markSkipped(setQueue: (fn: (q: QueueItem[]) => QueueItem[]) => void) {
  setQueue((q) =>
    q.map((it) => (it.state === "pending" ? { ...it, state: "skipped" } : it))
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function newId(): string {
  return `q-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
