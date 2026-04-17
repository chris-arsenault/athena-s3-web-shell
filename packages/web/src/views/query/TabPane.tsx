import { useCallback, useEffect, useState } from "react";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { writeScratchpad } from "../../data/scratchpadRepo";
import { QueryToolbar } from "./QueryToolbar";
import { ResultsPane } from "./ResultsPane";
import { RunQueuePanel } from "./RunQueuePanel";
import { SaveQueryModal } from "./SaveQueryModal";
import { selectedError, useQueryViewState } from "./useQueryViewState";
import type { Tab } from "./useTabs";
import { SqlEditor } from "./SqlEditor";

interface Props {
  tab: Tab;
  hidden: boolean;
  onPatch: (patch: Partial<Tab>) => void;
  onPickSavedSignal: { queryId: string; sql: string } | null;
  onHistorySignal: { executionId: string; sql: string } | null;
  onSavedQueryCreated: () => void;
  onScratchpadSaved: () => void;
}

export function TabPane(props: Props) {
  const { tab, hidden, onPatch } = props;
  const { provider } = useAuth();
  const s = useQueryViewState({ provider, initialSql: tab.sql });
  const [saveError, setSaveError] = useState<string | null>(null);
  useTabSync(s, tab, hidden, onPatch, props.onPickSavedSignal, props.onHistorySignal);
  const onScratchpadSave = useScratchpadSave(tab, s, onPatch, setSaveError, props.onScratchpadSaved);
  const onSaved = useCallback(() => {
    s.setSaveOpen(false);
    props.onSavedQueryCreated();
  }, [s, props]);

  return (
    <div
      className={`query-main flex-col flex-1 ${hidden ? "is-hidden" : ""}`}
      data-testid={`tabpane-${tab.id}`}
      aria-hidden={hidden}
    >
      <QueryToolbar
        status={s.displayStateLabel}
        isRunning={s.runQueue.isRunning}
        onRun={s.runAll}
        onStop={s.runQueue.stop}
        onSave={() => s.setSaveOpen(true)}
        canSave={s.sql.trim().length > 0 && !s.runQueue.isRunning}
        stopOnFailure={s.stopOnFailure}
        onToggleStopOnFailure={s.toggleStopOnFailure}
      />
      <div className="query-editor">
        <SqlEditor
          value={s.sql}
          onChange={s.setSql}
          onRunAtCursor={s.runAtCursor}
          onRunAll={s.runAll}
          onRunSelection={s.runSelection}
          onSave={tab.source ? onScratchpadSave : undefined}
        />
      </div>
      {saveError && (
        <ErrorBanner
          error={new Error(saveError)}
          onDismiss={() => setSaveError(null)}
        />
      )}
      <RunQueuePanel
        queue={s.runQueue.queue}
        selectedId={s.runQueue.selectedId}
        onSelect={s.selectQueueItem}
      />
      <ErrorBanner error={selectedError(s.selected)} onDismiss={noop} />
      <ResultsPane
        results={s.displayResults}
        status={s.displayStatus}
        loadingMore={s.loadingMore}
        onLoadMore={s.onLoadMore}
      />
      {s.saveOpen && (
        <SaveQueryModal sql={s.sql} onClose={() => s.setSaveOpen(false)} onSaved={onSaved} />
      )}
    </div>
  );
}

function noop() {}

type S = ReturnType<typeof useQueryViewState>;

function useTabSync(
  s: S,
  tab: Tab,
  hidden: boolean,
  onPatch: (patch: Partial<Tab>) => void,
  pickSignal: { queryId: string; sql: string } | null,
  historySignal: { executionId: string; sql: string } | null
): void {
  useEffect(() => {
    if (s.sql !== tab.sql) onPatch({ sql: s.sql });
  }, [s.sql, tab.sql, onPatch]);
  useEffect(() => {
    if (pickSignal && !hidden) s.replaceSql(pickSignal.sql);
  }, [pickSignal?.queryId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (historySignal && !hidden) s.replaceSql(historySignal.sql);
  }, [historySignal?.executionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const execId = s.selected?.executionId;
    if (execId && execId !== tab.lastExecutionId) onPatch({ lastExecutionId: execId });
  }, [s.selected?.executionId, tab.lastExecutionId, onPatch]);
}

function useScratchpadSave(
  tab: Tab,
  s: S,
  onPatch: (patch: Partial<Tab>) => void,
  setError: (msg: string | null) => void,
  onSaved: () => void
): () => Promise<void> {
  const { provider, context } = useAuth();
  return useCallback(async () => {
    if (!context || !tab.source) return;
    setError(null);
    try {
      const out = await writeScratchpad(
        provider,
        context,
        tab.source.key,
        s.sql,
        tab.source.etag
      );
      onPatch({ savedSql: s.sql, source: { ...tab.source, etag: out.etag } });
      onSaved();
    } catch (e) {
      const err = e as Error & { code?: string };
      setError(
        err.code === "etag_mismatch"
          ? `${tab.source.key} changed externally — reload or save as copy`
          : err.message
      );
    }
  }, [context, tab.source, provider, s.sql, onPatch, setError, onSaved]);
}

export type TabEvent =
  | { kind: "saved"; queryId: string; savedQuery: SavedQuery }
  | { kind: "history"; entry: HistoryEntry };
