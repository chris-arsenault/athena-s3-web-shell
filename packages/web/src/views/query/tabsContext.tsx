import { createContext, useContext, type ReactNode } from "react";

import { useTabs, type UseTabs } from "./useTabs";

const TabsCtx = createContext<UseTabs | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const tabsApi = useTabs();
  return <TabsCtx.Provider value={tabsApi}>{children}</TabsCtx.Provider>;
}

export function useTabsContext(): UseTabs {
  const v = useContext(TabsCtx);
  if (!v) throw new Error("useTabsContext must be used inside <TabsProvider>");
  return v;
}
