import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { readScratchpad } from "../../data/scratchpadRepo";
import { HistoryPanel } from "./HistoryPanel";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
import { SchemaTree } from "./SchemaTree";
import { ScratchpadPanel } from "./ScratchpadPanel";
import { TabPane, type ActiveTabHandle } from "./TabPane";
import { TabStrip } from "./TabStrip";
import { useTabs, type Tab, type UseTabs } from "./useTabs";
import "./QueryView.css";

// Module-scoped so StrictMode's double-invoke of the mount effect
// doesn't duplicate the prefill tab — both invocations share the
// same consumption set.
const consumedPrefillTokens = new Set<string>();

function usePrefillTableParam(ready: boolean, tabsApi: UseTabs): void {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!ready) return;
    const prefill = params.get("prefillTable");
    if (!prefill) return;
    if (consumedPrefillTokens.has(prefill)) return;
    consumedPrefillTokens.add(prefill);
    // Cap the set so a long session doesn't leak.
    if (consumedPrefillTokens.size > 64) {
      const first = consumedPrefillTokens.values().next().value;
      if (first !== undefined) consumedPrefillTokens.delete(first);
    }
    // Open a NEW tab so an unsaved draft in the active tab isn't
    // clobbered by a crosslink.
    tabsApi.newTabWithSql(`SELECT * FROM ${prefill} LIMIT 100`, prefill);
    // Scrub the param so a reload doesn't keep re-firing the prefill.
    const next = new URLSearchParams(params);
    next.delete("prefillTable");
    setParams(next, { replace: true });
  }, [ready, params, setParams, tabsApi]);
}

export function QueryView() {
  return <QueryViewInner />;
}

function QueryViewInner() {
  const { provider, context, loading } = useAuth();
  const tabsApi = useTabs();
  const [savedKey, setSavedKey] = useState(0);
  const [scratchpadKey, setScratchpadKey] = useState(0);
  // Imperative handle published by the active TabPane — parent calls
  // through this for one-shot SQL replacement (saved-query pick,
  // history select). No state = no stale signal re-firing on tab
  // switch.
  const activeHandleRef = useRef<ActiveTabHandle | null>(null);
  usePrefillTableParam(tabsApi.ready, tabsApi);

  if (loading || !context || !tabsApi.ready) {
    return <LoadingSpinner label="query workspace" />;
  }

  const onPickSaved = (q: SavedQuery) => {
    activeHandleRef.current?.replaceSql(q.sql);
  };
  const onSelectHistory = (e: HistoryEntry) => {
    activeHandleRef.current?.replaceSql(e.sql);
  };
  const onPeekTable = (db: string, table: string) => {
    // Athena engine v3 (Trino) rejects backtick-quoted identifiers in
    // DML ("Queries of this type are not supported"). Our sanitizer
    // already constrains db/table names to [a-z0-9_], so we can safely
    // emit them unquoted.
    activeHandleRef.current?.runSql(`SELECT * FROM ${db}.${table} LIMIT 10`);
  };
  const onOpenScratchpad = async (key: string, name: string) => {
    const { content, etag } = await readScratchpad(provider, context, key);
    tabsApi.openScratchpad(key, name, content, etag);
  };

  return (
    <div className="query-view flex-row flex-1">
      <aside className="query-side flex-col">
        <SchemaTree onPeekTable={onPeekTable} />
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
              activeHandleRef={activeHandleRef}
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
