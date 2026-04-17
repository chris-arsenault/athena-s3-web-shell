import type { QueryRequest, QueryResultPage, QueryStatus } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiDelete, apiGet, apiPost } from "./api";
import { mockAthena } from "./mockAthena";

export type { QueryResultPage };

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
  executionId: string,
  nextToken?: string
): Promise<QueryResultPage> {
  if (provider.isMock()) return mockAthena.getResults(executionId, nextToken);
  return apiGet(`/query/${executionId}/results`, {
    authHeader: await authHeader(provider),
    query: { nextToken },
  });
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

/**
 * Fetch the complete result set for an execution bypassing paginated
 * `GetQueryResults`. Returns null in mock mode — callers fall back to
 * the simulated mockAthena pagination path.
 */
export async function fetchAllResultsDirect(
  provider: AuthProvider,
  executionId: string,
  firstPage: QueryResultPage
): Promise<QueryResultPage | null> {
  if (provider.isMock()) return mockAthena.fetchAllResultsDirect(executionId, firstPage);
  const { url } = await apiGet<{ url: string }>(
    `/query/${executionId}/results-url`,
    { authHeader: await authHeader(provider) }
  );
  // Presigned S3 URL — signature is the auth, no proxy auth header applies.
  // `apiGet` is for /api/* JSON only; this path is intentionally raw fetch.
  // eslint-disable-next-line local/no-direct-fetch
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Direct S3 result fetch failed: ${response.status}`);
  }
  const text = await response.text();
  return parseCsvResults(text, firstPage);
}

async function parseCsvResults(
  text: string,
  firstPage: QueryResultPage
): Promise<QueryResultPage> {
  const Papa = (await import("papaparse")).default;
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = parsed.data;
  // First CSV row is Athena's header; drop it.
  const dataRows = rows.length > 0 ? rows.slice(1) : [];
  return {
    columns: firstPage.columns,
    rows: dataRows,
    nextToken: undefined,
  };
}
