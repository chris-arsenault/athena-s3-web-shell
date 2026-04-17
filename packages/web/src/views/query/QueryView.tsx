import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { readScratchpad } from "../../data/scratchpadRepo";
import { HistoryPanel } from "./HistoryPanel";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
import { SchemaTree } from "./SchemaTree";
import { ScratchpadPanel } from "./ScratchpadPanel";
import { TabPane } from "./TabPane";
import { TabStrip } from "./TabStrip";
import { useTabs, type Tab } from "./useTabs";
import "./QueryView.css";

type SavedSignalSetter = React.Dispatch<
  React.SetStateAction<{ queryId: string; sql: string } | null>
>;

function usePrefillTableParam(
  ready: boolean,
  setSavedSignal: SavedSignalSetter
): void {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!ready) return;
    const prefill = params.get("prefillTable");
    if (!prefill) return;
    setSavedSignal({
      queryId: `prefill-${prefill}-${Date.now()}`,
      sql: `SELECT * FROM ${prefill} LIMIT 100`,
    });
    // Scrub the param so a reload doesn't keep re-firing the prefill.
    const next = new URLSearchParams(params);
    next.delete("prefillTable");
    setParams(next, { replace: true });
  }, [ready, params, setParams, setSavedSignal]);
}

export function QueryView() {
  return <QueryViewInner />;
}

function QueryViewInner() {
  const { provider, context, loading } = useAuth();
  const tabsApi = useTabs();
  const [savedSignal, setSavedSignal] =
    useState<{ queryId: string; sql: string } | null>(null);
  const [historySignal, setHistorySignal] =
    useState<{ executionId: string; sql: string } | null>(null);
  const [savedKey, setSavedKey] = useState(0);
  const [scratchpadKey, setScratchpadKey] = useState(0);
  usePrefillTableParam(tabsApi.ready, setSavedSignal);

  if (loading || !context || !tabsApi.ready) {
    return <LoadingSpinner label="query workspace" />;
  }

  const onPickSaved = (q: SavedQuery) => {
    setSavedSignal({ queryId: q.id + "-" + Date.now(), sql: q.sql });
  };
  const onSelectHistory = (e: HistoryEntry) => {
    setHistorySignal({ executionId: e.executionId + "-" + Date.now(), sql: e.sql });
  };
  const onOpenScratchpad = async (key: string, name: string) => {
    const { content, etag } = await readScratchpad(provider, context, key);
    tabsApi.openScratchpad(key, name, content, etag);
  };

  return (
    <div className="query-view flex-row flex-1">
      <aside className="query-side flex-col">
        <SchemaTree />
        <SavedQueriesPanel
          refreshKey={savedKey}
          onPick={onPickSaved}
          onChanged={() => setSavedKey((k) => k + 1)}
        />
        <ScratchpadPanel
          refreshKey={scratchpadKey}
          onOpen={onOpenScratchpad}
          onChanged={() => setScratchpadKey((k) => k + 1)}
        />
      </aside>
      <section className="query-main-wrap flex-col flex-1">
        <TabStrip
          tabs={tabsApi.tabs}
          activeId={tabsApi.activeId}
          onActivate={tabsApi.setActive}
          onClose={tabsApi.closeTab}
          onNew={() => tabsApi.newTab()}
          onRename={tabsApi.renameTab}
        />
        <div className="query-panes flex-1">
          {tabsApi.tabs.map((tab) => (
            <TabPane
              key={tab.id}
              tab={tab}
              hidden={tab.id !== tabsApi.activeId}
              onPatch={(patch: Partial<Tab>) => tabsApi.patchTab(tab.id, patch)}
              onPickSavedSignal={tab.id === tabsApi.activeId ? savedSignal : null}
              onHistorySignal={tab.id === tabsApi.activeId ? historySignal : null}
              onSavedQueryCreated={() => setSavedKey((k) => k + 1)}
              onScratchpadSaved={() => setScratchpadKey((k) => k + 1)}
            />
          ))}
        </div>
      </section>
      <aside className="query-history">
        <HistoryPanel
          onSelect={onSelectHistory}
          refreshKey={tabsApi.activeTab?.lastExecutionId ?? ""}
        />
      </aside>
    </div>
  );
}
