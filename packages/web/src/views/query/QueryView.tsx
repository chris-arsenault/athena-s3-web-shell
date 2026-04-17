import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { SchemaProvider } from "../../data/schemaContext";
import { HistoryPanel } from "./HistoryPanel";
import { QueryToolbar } from "./QueryToolbar";
import { ResultsPane } from "./ResultsPane";
import { RunQueuePanel } from "./RunQueuePanel";
import { SaveQueryModal } from "./SaveQueryModal";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
import { SchemaTree } from "./SchemaTree";
import { SqlEditor } from "./SqlEditor";
import { selectedError, useQueryViewState } from "./useQueryViewState";
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
  const s = useQueryViewState({ provider });
  if (loading || !context) return <LoadingSpinner label="query workspace" />;
  return (
    <div className="query-view flex-row flex-1">
      <aside className="query-side flex-col">
        <SchemaTree />
        <SavedQueriesPanel
          refreshKey={s.savedKey}
          onPick={(q: SavedQuery) => s.replaceSql(q.sql)}
          onChanged={s.bumpSavedKey}
        />
      </aside>
      <section className="query-main flex-col flex-1">
        <QueryToolbar
          status={s.displayStateLabel}
          isRunning={s.runQueue.isRunning}
          onRun={s.runAll}
          onStop={s.runQueue.stop}
          onSave={openSave(s)}
          canSave={s.canSave}
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
      </section>
      <aside className="query-history">
        <HistoryPanel
          onSelect={(e: HistoryEntry) => s.replaceSql(e.sql)}
          refreshKey={s.selected?.executionId ?? ""}
        />
      </aside>
      {s.saveOpen && (
        <SaveQueryModal sql={s.sql} onClose={closeSave(s)} onSaved={onSaved(s)} />
      )}
    </div>
  );
}

type S = ReturnType<typeof useQueryViewState>;
const openSave = (s: S) => () => s.setSaveOpen(true);
const closeSave = (s: S) => () => s.setSaveOpen(false);
const onSaved = (s: S) => () => {
  s.setSaveOpen(false);
  s.bumpSavedKey();
};

function noop() {}
