import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { writeScratchpad } from "../../data/scratchpadRepo";
import { BrowserTabPane } from "./BrowserTabPane";
import { QueryToolbar } from "./QueryToolbar";
import { ResultsPane } from "./ResultsPane";
import { RunQueuePanel } from "./RunQueuePanel";
import { SaveQueryModal } from "./SaveQueryModal";
import { selectedError, useQueryViewState } from "./useQueryViewState";
import type { Tab } from "./useTabs";
import { SqlEditor } from "./SqlEditor";

export interface ActiveTabHandle {
  replaceSql: (sql: string) => void;
  /** Run a one-off statement through this tab's run queue without
   *  touching the editor buffer. Used for the schema-tree double-
   *  click "peek" — the user's current SQL stays as-is, results
   *  show under the active tab. */
  runSql: (sql: string) => void;
}

/**
 * Parent owns a map keyed by tab id; each SQL tab registers its own
 * handle regardless of active/hidden state. Callers resolve via the
 * current active id at click time, so tab activation doesn't race the
 * effect schedule.
 */
export type HandleMap = { current: Map<string, ActiveTabHandle> };

interface Props {
  tab: Tab;
  hidden: boolean;
  onPatch: (patch: Partial<Tab>) => void;
  /** Per-tab handle map owned by the parent — each tab registers by id. */
  handleMap: HandleMap;
  onSavedQueryCreated: () => void;
  onScratchpadSaved: () => void;
}

export function TabPane(props: Props) {
  if (props.tab.kind === "browser") {
    return <BrowserTabPane tab={props.tab} hidden={props.hidden} onPatch={props.onPatch} />;
  }
  return <SqlTabPane {...props} />;
}

function SqlTabPane(props: Props) {
  const { tab, hidden, onPatch } = props;
  const { provider } = useAuth();
  const s = useQueryViewState({ provider, initialSql: tab.sql });
  const [saveError, setSaveError] = useState<string | null>(null);
  const cursorOffsetRef = useRef<number>(0);
  useTabSync(s, tab, onPatch);
  const runSqlPeek = useCallback((sql: string) => s.runQueue.runAll([sql]), [s.runQueue]);
  useTabHandleRegistration(tab.id, s.replaceSql, runSqlPeek, props.handleMap);
  const onScratchpadSave = useScratchpadSave(tab, s, onPatch, setSaveError, props.onScratchpadSaved);
  const onSaved = useCallback(() => {
    s.setSaveOpen(false);
    props.onSavedQueryCreated();
  }, [s, props]);
  const fileDirty = !!tab.source && s.sql !== (tab.savedSql ?? "");

  return (
    <div
      className={`query-main flex-col flex-1 ${hidden ? "is-hidden" : ""}`}
      data-testid={`tabpane-${tab.id}`}
      aria-hidden={hidden}
    >
      <QueryToolbar
        status={s.displayStateLabel}
        isRunning={s.runQueue.isRunning}
        onRunStatement={() => s.runAtCursor(cursorOffsetRef.current)}
        onRunAll={s.runAll}
        onStop={s.runQueue.stop}
        onSaveNamed={() => s.setSaveOpen(true)}
        canSave={s.sql.trim().length > 0 && !s.runQueue.isRunning}
        stopOnFailure={s.stopOnFailure}
        onToggleStopOnFailure={s.toggleStopOnFailure}
        onSaveFile={tab.source ? onScratchpadSave : undefined}
        fileDirty={fileDirty}
      />
      {saveError && (
        <ErrorBanner
          error={new Error(saveError)}
          onDismiss={() => setSaveError(null)}
        />
      )}
      <PanelGroup
        direction="vertical"
        autoSaveId="athena-shell.query-tabpane"
        className="query-split"
      >
        <Panel id="editor" order={1} defaultSize={50} minSize={15} className="query-editor-panel">
          <div className="query-editor">
            <SqlEditor
              value={s.sql}
              onChange={s.setSql}
              onRunAtCursor={s.runAtCursor}
              onRunAll={s.runAll}
              onRunSelection={s.runSelection}
              onSave={tab.source ? onScratchpadSave : undefined}
              onCursorChange={(offset) => {
                cursorOffsetRef.current = offset;
              }}
            />
          </div>
        </Panel>
        <PanelResizeHandle />
        <Panel id="results" order={2} defaultSize={50} minSize={15} className="query-results-panel">
          <TabPaneResultsArea s={s} />
        </Panel>
      </PanelGroup>
      {s.saveOpen && (
        <SaveQueryModal sql={s.sql} onClose={() => s.setSaveOpen(false)} onSaved={onSaved} />
      )}
    </div>
  );
}

function noop() {}

function TabPaneResultsArea({ s }: { s: S }) {
  return (
    <div className="query-results-area flex-col">
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
    </div>
  );
}

type S = ReturnType<typeof useQueryViewState>;

function useTabSync(
  s: S,
  tab: Tab,
  onPatch: (patch: Partial<Tab>) => void
): void {
  useEffect(() => {
    if (s.sql !== tab.sql) onPatch({ sql: s.sql });
  }, [s.sql, tab.sql, onPatch]);
  useEffect(() => {
    const execId = s.selected?.executionId;
    if (execId && execId !== tab.lastExecutionId) onPatch({ lastExecutionId: execId });
  }, [s.selected?.executionId, tab.lastExecutionId, onPatch]);
}

/**
 * While this pane is active, publish its imperative handle on the
 * shared ref so the parent's saved-query / history pickers can
 * replace THIS tab's SQL without relying on leaky signal state that
 * re-fires on unrelated tab switches.
 */
function useTabHandleRegistration(
  tabId: string,
  replaceSql: (sql: string) => void,
  runSql: (sql: string) => void,
  handleMap: HandleMap
): void {
  // Register regardless of hidden state. Callers look up by active
  // tab id so inactive-tab handles are always present but never
  // invoked — no race with tab activation.
  useLayoutEffect(() => {
    const handle: ActiveTabHandle = { replaceSql, runSql };
    handleMap.current.set(tabId, handle);
    return () => {
      const cur = handleMap.current.get(tabId);
      if (cur === handle) handleMap.current.delete(tabId);
    };
  }, [tabId, replaceSql, runSql, handleMap]);
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
