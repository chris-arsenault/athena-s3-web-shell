import { useCallback, useState } from "react";

import {
  QUERY_POLL_INTERVAL_MS,
  QUERY_POLL_TIMEOUT_MS,
  type QueryResultPage,
  type QueryStatus,
} from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { getQuery, getResults, startQuery } from "../../data/queryRepo";

interface Opts {
  provider: AuthProvider;
  sql: string;
  onStatus: (s: QueryStatus | null) => void;
  onResults: (r: QueryResultPage | null) => void;
  onError: (e: Error | null) => void;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function useQueryRunner({ provider, sql, onStatus, onResults, onError }: Opts) {
  const [isRunning, setIsRunning] = useState(false);

  const run = useCallback(async () => {
    onError(null);
    onResults(null);
    onStatus(null);
    setIsRunning(true);
    try {
      const { executionId } = await startQuery(provider, { sql });
      const start = Date.now();
      for (;;) {
        const status = await getQuery(provider, executionId);
        onStatus(status);
        if (TERMINAL.has(status.state)) {
          if (status.state === "SUCCEEDED") {
            const r = await getResults(provider, executionId);
            onResults(r);
          } else if (status.state === "FAILED") {
            onError(new Error(status.stateChangeReason ?? "Query failed"));
          }
          break;
        }
        if (Date.now() - start > QUERY_POLL_TIMEOUT_MS) {
          onError(new Error("Query timed out polling for completion"));
          break;
        }
        await new Promise((r) => setTimeout(r, QUERY_POLL_INTERVAL_MS));
      }
    } catch (e) {
      onError(e as Error);
    } finally {
      setIsRunning(false);
    }
  }, [provider, sql, onStatus, onResults, onError]);

  return { run, isRunning };
}
