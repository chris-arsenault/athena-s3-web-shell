import type { AuthProvider } from "../auth/AuthProvider";
import { apiPost } from "./api";
import { mockSaveResult } from "./mockAthena";
import { proxyHeaders } from "./proxyHeaders";

export interface SaveResultOptions {
  targetKey: string;
  includeSqlSidecar: boolean;
  overwrite: boolean;
}

export interface SaveResultResponse {
  key: string;
  sidecarKey?: string;
}

export async function saveResultToWorkspace(
  provider: AuthProvider,
  executionId: string,
  opts: SaveResultOptions
): Promise<SaveResultResponse> {
  if (provider.isMock()) return mockSaveResult(executionId, opts);
  return apiPost(
    `/query/${encodeURIComponent(executionId)}/save-to-workspace`,
    opts,
    { ...(await proxyHeaders(provider)) }
  );
}
