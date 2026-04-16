import type { QueryRequest, QueryResultPage, QueryStatus } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiDelete, apiGet, apiPost } from "./api";
import { mockAthena } from "./mockAthena";

async function authHeader(provider: AuthProvider) {
  return provider.getProxyAuthHeader();
}

export async function startQuery(
  provider: AuthProvider,
  req: QueryRequest
): Promise<{ executionId: string }> {
  if (provider.isMock()) return mockAthena.startQuery(req.sql, req.database);
  return apiPost("/query", req, { authHeader: await authHeader(provider) });
}

export async function getQuery(
  provider: AuthProvider,
  executionId: string
): Promise<QueryStatus> {
  if (provider.isMock()) return mockAthena.getQuery(executionId);
  return apiGet(`/query/${executionId}`, { authHeader: await authHeader(provider) });
}

export async function stopQuery(
  provider: AuthProvider,
  executionId: string
): Promise<void> {
  if (provider.isMock()) return mockAthena.stopQuery(executionId);
  await apiDelete(`/query/${executionId}`, { authHeader: await authHeader(provider) });
}

export async function getResults(
  provider: AuthProvider,
  executionId: string
): Promise<QueryResultPage> {
  if (provider.isMock()) return mockAthena.getResults(executionId);
  return apiGet(`/query/${executionId}/results`, { authHeader: await authHeader(provider) });
}

export async function getDownloadUrl(
  provider: AuthProvider,
  executionId: string
): Promise<string | null> {
  if (provider.isMock()) return null;
  const out = await apiGet<{ url: string }>(`/query/${executionId}/download`, {
    authHeader: await authHeader(provider),
  });
  return out.url;
}
