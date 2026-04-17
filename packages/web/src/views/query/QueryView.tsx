import { useState } from "react";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { SchemaProvider } from "../../data/schemaContext";
import { HistoryPanel } from "./HistoryPanel";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
import { SchemaTree } from "./SchemaTree";
import { TabPane } from "./TabPane";
import { TabStrip } from "./TabStrip";
import { useTabs, type Tab } from "./useTabs";
import "./QueryView.css";

export function QueryView() {
  return (
    <SchemaProvider>
      <QueryViewInner />
    </SchemaProvider>
  );
}

function QueryViewInner() {
  const { context, loading } = useAuth();
  const tabsApi = useTabs();
  const [savedSignal, setSavedSignal] =
    useState<{ queryId: string; sql: string } | null>(null);
  const [historySignal, setHistorySignal] =
    useState<{ executionId: string; sql: string } | null>(null);
  const [savedKey, setSavedKey] = useState(0);

  if (loading || !context || !tabsApi.ready) {
    return <LoadingSpinner label="query workspace" />;
  }

  const onPickSaved = (q: SavedQuery) => {
    setSavedSignal({ queryId: q.id + "-" + Date.now(), sql: q.sql });
  };
  const onSelectHistory = (e: HistoryEntry) => {
    setHistorySignal({ executionId: e.executionId + "-" + Date.now(), sql: e.sql });
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
