import type { DatabaseRef, Page, TableDetail, TableRef } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiGet } from "./api";
import { mockAthena } from "./mockAthena";

async function authHeader(provider: AuthProvider) {
  return provider.getProxyAuthHeader();
}

export async function listDatabases(provider: AuthProvider): Promise<Page<DatabaseRef>> {
  if (provider.isMock()) return mockAthena.listDatabases();
  return apiGet("/schema/databases", { authHeader: await authHeader(provider) });
}

export async function listTables(
  provider: AuthProvider,
  database: string
): Promise<Page<TableRef>> {
  if (provider.isMock()) return mockAthena.listTables(database);
  return apiGet(`/schema/databases/${encodeURIComponent(database)}/tables`, {
    authHeader: await authHeader(provider),
  });
}

export async function getTable(
  provider: AuthProvider,
  database: string,
  table: string
): Promise<TableDetail> {
  if (provider.isMock()) return mockAthena.getTable(database, table);
  return apiGet(
    `/schema/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(table)}`,
    { authHeader: await authHeader(provider) }
  );
}
