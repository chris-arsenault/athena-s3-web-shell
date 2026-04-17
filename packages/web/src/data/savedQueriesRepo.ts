import type {
  SavedQueriesPage,
  SaveQueryRequest,
} from "@athena-shell/shared";

import { useAuth } from "../auth/authContext";
import type { AuthProvider } from "../auth/AuthProvider";
import { apiDelete, apiGet, apiPost } from "./api";
import { mockSavedQueries } from "./mockSavedQueries";
import { proxyHeaders } from "./proxyHeaders";

export async function listSavedQueries(
  provider: AuthProvider,
  workgroup: string
): Promise<SavedQueriesPage> {
  if (provider.isMock()) return mockSavedQueries.list(workgroup);
  return apiGet("/saved-queries", { ...(await proxyHeaders(provider)) });
}

export async function createSavedQuery(
  provider: AuthProvider,
  scope: { workgroup: string; userDatabase?: string },
  req: SaveQueryRequest
): Promise<{ id: string }> {
  if (provider.isMock()) {
    return mockSavedQueries.create(scope.workgroup, scope.userDatabase, req);
  }
  return apiPost("/saved-queries", req, { ...(await proxyHeaders(provider)) });
}

export async function deleteSavedQuery(
  provider: AuthProvider,
  workgroup: string,
  id: string
): Promise<void> {
  if (provider.isMock()) return mockSavedQueries.delete(workgroup, id);
  await apiDelete(`/saved-queries/${encodeURIComponent(id)}`, {
    ...(await proxyHeaders(provider)),
  });
}

// Convenience: re-export the auth hook so callers can one-import the
// whole module when wiring the panel. Keeps imports terse in UI code.
export { useAuth };
