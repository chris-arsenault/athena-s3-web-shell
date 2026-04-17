import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";

import type { AuthContext, HistoryEntry, SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { SidePanelSection } from "../../components/SidePanelSection";
import { readScratchpad } from "../../data/scratchpadRepo";
import { HistoryPanel } from "./HistoryPanel";
import { SavedQueriesPanel } from "./SavedQueriesPanel";
import { SchemaTree } from "./SchemaTree";
import { ScratchpadPanel } from "./ScratchpadPanel";
import { TabPane, type ActiveTabHandle, type HandleMap } from "./TabPane";
import { TabStrip } from "./TabStrip";
import { useTabsContext } from "./tabsContext";
import { type Tab, type UseTabs } from "./useTabs";
import { WorkspaceSection } from "./WorkspaceSection";
import "./QueryView.css";

// Module-scoped so StrictMode's double-invoke of the mount effect
// doesn't duplicate the prefill tab — both invocations share the
// same consumption set.
const consumedPrefillTokens = new Set<string>();

/**
 * On mount (once tabs have hydrated), align the active tab with the
 * landing route. `/workspace` opens or focuses a browser tab (honouring
 * `?prefix` for crosslinks). `/query` activates a SQL tab (creating one
 * if somehow absent). `/` leaves whatever was persisted alone.
 */
function useRouteTabSeed(
  ready: boolean,
  tabsApi: UseTabs,
  context: AuthContext | null
): void {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const seededRef = useRef(false);
  useEffect(() => {
    if (!ready || seededRef.current) return;
    if (pathname === "/workspace") {
      seededRef.current = true;
      const requested = params.get("prefix");
      const target = requested ?? context?.s3.prefix;
      if (!target) return;
      tabsApi.openBrowserTab(target);
    } else if (pathname === "/query") {
      seededRef.current = true;
      const existing = tabsApi.tabs.find((t) => (t.kind ?? "sql") === "sql");
      if (existing) tabsApi.setActive(existing.id);
      else tabsApi.newTab();
    }
  }, [ready, pathname, params, tabsApi, context?.s3.prefix]);
}

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
  const tabsApi = useTabsContext();
  const [savedKey, setSavedKey] = useState(0);
  const [scratchpadKey, setScratchpadKey] = useState(0);
  const [journalCollapsed, setJournalCollapsed] = useState(false);
  const journalRef = useRef<ImperativePanelHandle>(null);
  const toggleJournal = useCallback(() => {
    const panel = journalRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }, []);
  // Per-tab handle map (not a single activeRef) — each SQL tab
  // registers by id regardless of hidden state, so tab-activation never
  // races the effect schedule. The callers below resolve by tabsApi.activeId.
  const handleMapRef = useRef<Map<string, ActiveTabHandle>>(new Map());
  const handleMap: HandleMap = handleMapRef;
  // Keep the tabs api + context reachable from stable callbacks so the
  // on-click closures we hand down to SchemaTree / SavedQueries don't
  // get re-identified on every QueryView render. Otherwise React
  // detaches + re-attaches DOM listeners mid-gesture (click → click →
  // dblclick), and a double-click on a tree-row can land on a listener
  // that no longer routes to onPeek.
  const tabsApiRef = useRef(tabsApi);
  tabsApiRef.current = tabsApi;
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const contextRef = useRef<AuthContext | null>(context ?? null);
  contextRef.current = context ?? null;
  useRouteTabSeed(tabsApi.ready, tabsApi, context);
  usePrefillTableParam(tabsApi.ready, tabsApi);

  if (loading || !context || !tabsApi.ready) {
    return <LoadingSpinner label="query workspace" />;
  }
  const handlers = buildHandlers(handleMap, tabsApiRef, providerRef, contextRef);

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="athena-shell.query-view"
      className="query-view"
    >
      <Panel id="q-side" order={1} defaultSize={18} minSize={12} maxSize={35} className="query-side-panel">
        <QuerySide
          savedKey={savedKey}
          scratchpadKey={scratchpadKey}
          onPickSaved={handlers.onPickSaved}
          onSavedChanged={() => setSavedKey((k) => k + 1)}
          onPeekTable={handlers.onPeekTable}
          onOpenScratchpad={handlers.onOpenScratchpad}
          onScratchpadChanged={() => setScratchpadKey((k) => k + 1)}
          onOpenBrowserTab={(p) => tabsApi.openBrowserTab(p)}
          activeBrowserPrefix={activeBrowserPrefix(tabsApi.activeTab)}
        />
      </Panel>
      <PanelResizeHandle />
      <Panel id="q-main" order={2} minSize={30} className="query-main-panel">
        <QueryMain tabsApi={tabsApi} handleMap={handleMap}
          onSavedChanged={() => setSavedKey((k) => k + 1)}
          onScratchpadChanged={() => setScratchpadKey((k) => k + 1)} />
      </Panel>
      <PanelResizeHandle />
      <Panel
        id="q-journal" order={3} ref={journalRef}
        collapsible collapsedSize={3} defaultSize={20} minSize={12} maxSize={40}
        onCollapse={() => setJournalCollapsed(true)}
        onExpand={() => setJournalCollapsed(false)}
        className="query-journal-panel"
      >
        <QueryJournal
          collapsed={journalCollapsed}
          onToggle={toggleJournal}
          onSelect={handlers.onSelectHistory}
          refreshKey={tabsApi.activeTab?.lastExecutionId ?? ""}
        />
      </Panel>
    </PanelGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Left side panel

interface QuerySideProps {
  savedKey: number;
  scratchpadKey: number;
  onPickSaved: (q: SavedQuery) => void;
  onSavedChanged: () => void;
  onPeekTable: (db: string, table: string) => void;
  onOpenScratchpad: (key: string, name: string) => Promise<void>;
  onScratchpadChanged: () => void;
  onOpenBrowserTab: (prefix: string) => void;
  activeBrowserPrefix: string | null;
}

function QuerySide(p: QuerySideProps) {
  return (
    <aside className="side-panel query-side flex-col" aria-label="Workspace panel">
      <SidePanelSection title="WORKSPACE" persistKey="q-workspace" grow>
        <WorkspaceSection
          onOpen={p.onOpenBrowserTab}
          activePrefix={p.activeBrowserPrefix}
        />
      </SidePanelSection>
      <SidePanelSection title="CATALOG" persistKey="q-catalog">
        <SchemaTree onPeekTable={p.onPeekTable} />
      </SidePanelSection>
      <SidePanelSection title="LIBRARY" persistKey="q-library">
        <SavedQueriesPanel
          refreshKey={p.savedKey}
          onPick={p.onPickSaved}
          onChanged={p.onSavedChanged}
        />
      </SidePanelSection>
      <SidePanelSection title="SCRATCHPAD" persistKey="q-scratchpad">
        <ScratchpadPanel
          refreshKey={p.scratchpadKey}
          onOpen={p.onOpenScratchpad}
          onChanged={p.onScratchpadChanged}
        />
      </SidePanelSection>
    </aside>
  );
}

function activeBrowserPrefix(tab: Tab | null): string | null {
  if (!tab) return null;
  if (tab.kind !== "browser") return null;
  return tab.prefix ?? null;
}

// ─────────────────────────────────────────────────────────────
// Center main (tabs + panes)

interface QueryMainProps {
  tabsApi: UseTabs;
  handleMap: HandleMap;
  onSavedChanged: () => void;
  onScratchpadChanged: () => void;
}

function QueryMain({ tabsApi, handleMap, onSavedChanged, onScratchpadChanged }: QueryMainProps) {
  return (
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
            handleMap={handleMap}
            onSavedQueryCreated={onSavedChanged}
            onScratchpadSaved={onScratchpadChanged}
          />
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Right inspector (journal)

interface QueryJournalProps {
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (e: HistoryEntry) => void;
  refreshKey: string;
}

function QueryJournal({ collapsed, onToggle, onSelect, refreshKey }: QueryJournalProps) {
  return (
    <aside
      className={`query-history ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Query journal"
    >
      {collapsed ? (
        <button
          type="button"
          className="journal-expand"
          onClick={onToggle}
          aria-label="Expand journal"
        >
          <span className="journal-collapsed-label tracked">JOURNAL</span>
          <span className="journal-collapsed-hint mono" aria-hidden>▸</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="journal-collapse"
            onClick={onToggle}
            aria-label="Collapse journal"
            title="Collapse journal"
          >
            <span className="mono" aria-hidden>▸</span>
          </button>
          <HistoryPanel onSelect={onSelect} refreshKey={refreshKey} />
        </>
      )}
    </aside>
  );
}

interface HandlerRefs {
  handleMap: HandleMap;
  tabsApiRef: React.MutableRefObject<UseTabs>;
  providerRef: React.MutableRefObject<ReturnType<typeof useAuth>["provider"]>;
  contextRef: React.MutableRefObject<AuthContext | null>;
}

function buildHandlers(
  handleMap: HandleMap,
  tabsApiRef: React.MutableRefObject<UseTabs>,
  providerRef: React.MutableRefObject<ReturnType<typeof useAuth>["provider"]>,
  contextRef: React.MutableRefObject<AuthContext | null>
) {
  return createHandlers({ handleMap, tabsApiRef, providerRef, contextRef });
}

function createHandlers(refs: HandlerRefs) {
  const activeHandle = (): ActiveTabHandle | undefined => {
    const id = refs.tabsApiRef.current.activeId;
    return id ? refs.handleMap.current.get(id) : undefined;
  };
  return {
    onPickSaved: (q: SavedQuery) => activeHandle()?.replaceSql(q.sql),
    onSelectHistory: (e: HistoryEntry) => activeHandle()?.replaceSql(e.sql),
    // Athena engine v3 (Trino) rejects backtick-quoted identifiers in
    // DML; our sanitizer constrains db/table to [a-z0-9_], unquoted is safe.
    onPeekTable: (db: string, table: string) =>
      activeHandle()?.runSql(`SELECT * FROM ${db}.${table} LIMIT 10`),
    onOpenScratchpad: async (key: string, name: string) => {
      const ctx = refs.contextRef.current;
      if (!ctx) return;
      const { content, etag } = await readScratchpad(refs.providerRef.current, ctx, key);
      refs.tabsApiRef.current.openScratchpad(key, name, content, etag);
    },
  };
}
