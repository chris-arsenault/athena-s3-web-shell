import { useCallback, useEffect } from "react";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
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
}

export function TabPane(props: Props) {
  const { tab, hidden, onPatch } = props;
  const { provider } = useAuth();
  const s = useQueryViewState({ provider, initialSql: tab.sql });

  useEffect(() => {
    if (s.sql !== tab.sql) onPatch({ sql: s.sql });
  }, [s.sql, tab.sql, onPatch]);

  useEffect(() => {
    const sig = props.onPickSavedSignal;
    if (sig && !hidden) s.replaceSql(sig.sql);
  }, [props.onPickSavedSignal?.queryId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sig = props.onHistorySignal;
    if (sig && !hidden) s.replaceSql(sig.sql);
  }, [props.onHistorySignal?.executionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const execId = s.selected?.executionId;
    if (execId && execId !== tab.lastExecutionId) {
      onPatch({ lastExecutionId: execId });
    }
  }, [s.selected?.executionId, tab.lastExecutionId, onPatch]);

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
        />
      </div>
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

export type TabEvent =
  | { kind: "saved"; queryId: string; savedQuery: SavedQuery }
  | { kind: "history"; entry: HistoryEntry };
