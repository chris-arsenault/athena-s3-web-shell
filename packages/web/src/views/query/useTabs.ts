import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { session, tabs as tabsStore, type TabRecord } from "../../data/localDb";

/**
 * Tab-strip state with IndexedDB-backed persistence. Loads on mount
 * (creating one empty tab if none exist); writes tab edits back
 * through a debounced save so rapid keystrokes don't hammer IDB.
 *
 * Each tab owns its own SQL buffer, selected database, and the last
 * query's executionId for result rehydration (#10 leaves the actual
 * rehydration call to the tab-content component — the hook itself
 * just preserves the `lastExecutionId` field).
 */

const SAVE_DEBOUNCE_MS = 500;
const SESSION_ACTIVE_KEY = "activeTabId";

export type Tab = TabRecord;

export interface UseTabs {
  tabs: Tab[];
  activeId: string | null;
  activeTab: Tab | null;
  ready: boolean;
  setActive: (id: string) => void;
  newTab: () => Tab;
  newTabWithSql: (sql?: string, name?: string) => Tab;
  newBrowserTab: (prefix: string, name?: string) => Tab;
  openBrowserTab: (prefix: string, name?: string) => Tab;
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  patchTab: (id: string, patch: Partial<Tab>) => void;
  openScratchpad: (key: string, name: string, content: string, etag?: string) => Tab;
}

export function useTabs(): UseTabs {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const tok = { cancelled: false };
    void hydrate(tok, setTabs, setActiveId, setReady);
    return () => {
      tok.cancelled = true;
    };
  }, []);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    void session.set(SESSION_ACTIVE_KEY, id);
  }, []);

  const builders = useMemo(
    () => buildTabBuilders(setTabs, setActive),
    [setActive]
  );

  const closeTab = useCallback(
    (id: string) => setTabs((prev) => closeFromList(prev, id, activeId, setActiveId)),
    [activeId]
  );
  const patchTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((prev) => {
      const next = prev.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t
      );
      const updated = next.find((t) => t.id === id);
      if (updated) scheduleSave(writeTimers.current, updated);
      return next;
    });
  }, []);
  const renameTab = useCallback(
    (id: string, name: string) => patchTab(id, { name }),
    [patchTab]
  );

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  return {
    tabs,
    activeId,
    activeTab,
    ready,
    setActive,
    newTab: builders.newTab,
    newTabWithSql: builders.newTabWithSql,
    newBrowserTab: builders.newBrowserTab,
    openBrowserTab: builders.openBrowserTab,
    openScratchpad: builders.openScratchpad,
    closeTab,
    renameTab,
    patchTab,
  };
}

type SetTabs = React.Dispatch<React.SetStateAction<Tab[]>>;

function buildTabBuilders(setTabs: SetTabs, setActive: (id: string) => void) {
  const newTabWithSql = (sql?: string, name?: string): Tab =>
    appendTab(setTabs, setActive, sql, name);
  const newTab = (): Tab => newTabWithSql();
  const newBrowserTab = (prefix: string, name?: string): Tab =>
    appendBrowserTab(setTabs, setActive, prefix, name);
  const openBrowserTab = (prefix: string, name?: string): Tab =>
    openOrReuseThen(setTabs, setActive, (prev) => openOrReuseBrowserTab(prev, prefix, name));
  const openScratchpad = (
    key: string,
    name: string,
    content: string,
    etag?: string
  ): Tab =>
    openOrReuseThen(setTabs, setActive, (prev) =>
      openOrReuseScratchpadTab(prev, key, name, content, etag)
    );
  return { newTab, newTabWithSql, newBrowserTab, openBrowserTab, openScratchpad };
}

function openOrReuseThen(
  setTabs: SetTabs,
  setActive: (id: string) => void,
  pick: (prev: Tab[]) => { next: Tab[]; tab: Tab }
): Tab {
  let created = newTabRecord(0);
  setTabs((prev) => {
    const { next, tab } = pick(prev);
    created = tab;
    // React processes updaters + queued state updates within the same
    // flush, so calling setActive here keeps the id in lockstep with
    // the tabs update. Reading `created` from the outer closure after
    // setTabs returns is a stale-read bug — the updater hasn't run yet.
    setActive(tab.id);
    return next;
  });
  return created;
}

function appendTab(
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  setActive: (id: string) => void,
  sql?: string,
  name?: string
): Tab {
  // Generate the record (including its id) OUTSIDE the updater so
  // `setActive(record.id)` sees the real id even if React defers the
  // updater. The updater re-computes `order` and `name` from `prev`
  // (those need to see the latest prev), then persists + appends.
  const base = newTabRecord(0);
  const record: Tab = {
    ...base,
    sql: sql ?? base.sql,
    name: name ?? base.name,
  };
  setTabs((prev) => {
    const finalized: Tab = {
      ...record,
      order: prev.length,
      name: name ?? `Query ${prev.length + 1}`,
    };
    void tabsStore.upsert(finalized);
    return [...prev, finalized];
  });
  setActive(record.id);
  return record;
}

function openOrReuseScratchpadTab(
  prev: Tab[],
  key: string,
  name: string,
  content: string,
  etag?: string
): { next: Tab[]; tab: Tab } {
  const existing = prev.find((t) => t.source?.key === key);
  if (existing) return { next: prev, tab: existing };
  const tab: Tab = {
    ...newTabRecord(prev.length),
    name,
    sql: content,
    savedSql: content,
    source: { kind: "scratchpad", key, etag },
  };
  void tabsStore.upsert(tab);
  return { next: [...prev, tab], tab };
}

function appendBrowserTab(
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  setActive: (id: string) => void,
  prefix: string,
  name?: string
): Tab {
  const base = newTabRecord(0);
  const record: Tab = {
    ...base,
    kind: "browser",
    prefix,
    sql: "",
    name: name ?? prefixDisplayName(prefix),
  };
  setTabs((prev) => {
    const finalized: Tab = {
      ...record,
      order: prev.length,
    };
    void tabsStore.upsert(finalized);
    return [...prev, finalized];
  });
  setActive(record.id);
  return record;
}

function openOrReuseBrowserTab(
  prev: Tab[],
  prefix: string,
  name?: string
): { next: Tab[]; tab: Tab } {
  const existing = prev.find((t) => t.kind === "browser" && t.prefix === prefix);
  if (existing) return { next: prev, tab: existing };
  const tab: Tab = {
    ...newTabRecord(prev.length),
    kind: "browser",
    prefix,
    sql: "",
    name: name ?? prefixDisplayName(prefix),
  };
  void tabsStore.upsert(tab);
  return { next: [...prev, tab], tab };
}

function prefixDisplayName(prefix: string): string {
  const trimmed = prefix.replace(/\/$/, "");
  if (!trimmed) return "/";
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last || "/";
}

interface CancelTok {
  cancelled: boolean;
}

async function hydrate(
  tok: CancelTok,
  setTabs: (t: Tab[]) => void,
  setActiveId: (id: string | null) => void,
  setReady: (b: boolean) => void
): Promise<void> {
  const loaded = await tabsStore.list();
  if (tok.cancelled) return;
  if (loaded.length === 0) {
    const first = newTabRecord(0);
    await tabsStore.upsert(first);
    if (tok.cancelled) return;
    await session.set(SESSION_ACTIVE_KEY, first.id);
    if (tok.cancelled) return;
    setTabs([first]);
    setActiveId(first.id);
  } else {
    const storedActive = await session.get(SESSION_ACTIVE_KEY);
    if (tok.cancelled) return;
    const active =
      storedActive && loaded.some((t) => t.id === storedActive)
        ? storedActive
        : loaded[0]!.id;
    setTabs(loaded);
    setActiveId(active);
  }
  setReady(true);
}

function closeFromList(
  prev: Tab[],
  id: string,
  activeId: string | null,
  setActiveId: (id: string) => void
): Tab[] {
  const idx = prev.findIndex((t) => t.id === id);
  if (idx === -1) return prev;
  void tabsStore.remove(id);
  const next = prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, order: i }));
  next.forEach((t) => void tabsStore.upsert(t));
  if (next.length === 0) {
    const fresh = newTabRecord(0);
    void tabsStore.upsert(fresh);
    void session.set(SESSION_ACTIVE_KEY, fresh.id);
    setActiveId(fresh.id);
    return [fresh];
  }
  if (id === activeId) {
    const neighbor = next[Math.min(idx, next.length - 1)]!;
    setActiveId(neighbor.id);
    void session.set(SESSION_ACTIVE_KEY, neighbor.id);
  }
  return next;
}

function scheduleSave(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  rec: Tab
): void {
  const existing = timers.get(rec.id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    void tabsStore.upsert(rec);
    timers.delete(rec.id);
  }, SAVE_DEBOUNCE_MS);
  timers.set(rec.id, t);
}

function newTabRecord(order: number): Tab {
  return {
    id: `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    name: `Query ${order + 1}`,
    sql: "SELECT 1 AS hello",
    order,
    updatedAt: new Date().toISOString(),
  };
}
