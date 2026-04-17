import type { HistoryEntry, HistoryPage } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiGet } from "./api";
import { favorites } from "./localDb";
import { mockAthena } from "./mockAthena";
import { proxyHeaders } from "./proxyHeaders";

export async function listHistory(provider: AuthProvider): Promise<HistoryPage> {
  const remote = provider.isMock()
    ? await mockAthena.listHistory()
    : await apiGet<HistoryPage>("/history", { ...(await proxyHeaders(provider)) });
  const favs = await favorites.list();
  const favIds = new Set(favs.map((f) => f.executionId));

  const merged = new Map<string, HistoryEntry>();
  for (const f of favs) {
    merged.set(f.executionId, {
      executionId: f.executionId,
      sql: f.sql,
      state: "SUCCEEDED",
      submittedAt: f.savedAt,
      workgroup: "",
      source: "local",
      favorite: true,
    });
  }
  for (const e of remote.items) {
    merged.set(e.executionId, { ...e, favorite: favIds.has(e.executionId) });
  }
  const items = [...merged.values()].sort((a, b) =>
    b.submittedAt.localeCompare(a.submittedAt)
  );
  return { items, nextToken: remote.nextToken };
}

export async function toggleFavorite(entry: HistoryEntry): Promise<void> {
  if (entry.favorite) {
    await favorites.remove(entry.executionId);
  } else {
    await favorites.add(entry.executionId, entry.sql);
  }
}
