import type { SavedQueriesPage, SavedQuery, SaveQueryRequest } from "@athena-shell/shared";

// Per-workgroup in-memory store so mock-mode reproduces Athena's native
// per-workgroup isolation — a saved query under `workspace_dev_user` is
// not visible to a query running in a different workgroup.
const store = new Map<string, Map<string, SavedQuery>>();

function bucket(workgroup: string): Map<string, SavedQuery> {
  let m = store.get(workgroup);
  if (!m) {
    m = new Map();
    store.set(workgroup, m);
  }
  return m;
}

export const mockSavedQueries = {
  async create(
    workgroup: string,
    userDatabase: string | undefined,
    req: SaveQueryRequest
  ): Promise<{ id: string }> {
    const id = `mock-nq-${Math.random().toString(36).slice(2, 10)}`;
    const entry: SavedQuery = {
      id,
      name: req.name,
      description: req.description,
      sql: req.sql,
      database: req.database ?? userDatabase,
      workgroup,
    };
    bucket(workgroup).set(id, entry);
    return { id };
  },

  async list(workgroup: string): Promise<SavedQueriesPage> {
    return { items: Array.from(bucket(workgroup).values()) };
  },

  async delete(workgroup: string, id: string): Promise<void> {
    bucket(workgroup).delete(id);
  },

  // Exposed for tests + E2E resets. Not part of the public repo API.
  _reset(): void {
    store.clear();
  },
};
