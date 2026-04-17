import { useCallback, useEffect, useRef, useState } from "react";

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
  closeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  patchTab: (id: string, patch: Partial<Tab>) => void;
}

export function useTabs(): UseTabs {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const writeTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void hydrate(cancelled, setTabs, setActiveId, setReady);
    return () => {
      cancelled = true;
    };
  }, []);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    void session.set(SESSION_ACTIVE_KEY, id);
  }, []);

  const newTab = useCallback((): Tab => {
    let created = newTabRecord(0);
    setTabs((prev) => {
      created = newTabRecord(prev.length);
      void tabsStore.upsert(created);
      return [...prev, created];
    });
    setActive(created.id);
    return created;
  }, [setActive]);

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
    newTab,
    closeTab,
    renameTab,
    patchTab,
  };
}

async function hydrate(
  cancelled: boolean,
  setTabs: (t: Tab[]) => void,
  setActiveId: (id: string | null) => void,
  setReady: (b: boolean) => void
): Promise<void> {
  const loaded = await tabsStore.list();
  if (cancelled) return;
  if (loaded.length === 0) {
    const first = newTabRecord(0);
    await tabsStore.upsert(first);
    await session.set(SESSION_ACTIVE_KEY, first.id);
    setTabs([first]);
    setActiveId(first.id);
  } else {
    const storedActive = await session.get(SESSION_ACTIVE_KEY);
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
