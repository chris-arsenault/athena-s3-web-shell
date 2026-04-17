import {
  BatchGetNamedQueryCommand,
  CreateNamedQueryCommand,
  DeleteNamedQueryCommand,
  ListNamedQueriesCommand,
  type AthenaClient,
  type NamedQuery,
} from "@aws-sdk/client-athena";

import type {
  AthenaScope,
  SavedQueriesPage,
  SavedQuery,
  SaveQueryRequest,
} from "@athena-shell/shared";

/**
 * Thin wrapper over Athena's NamedQuery API — `CreateNamedQuery` /
 * `ListNamedQueries` / `BatchGetNamedQuery` / `DeleteNamedQuery`.
 *
 * Named queries are WORKGROUP-scoped. Since our auth model (see
 * AlbAuthProvider) gives each user their own workgroup, Athena's own
 * per-workgroup isolation becomes per-user isolation for free — no
 * DynamoDB, no app-level scoping logic.
 *
 * Rename semantics: Athena has no `UpdateNamedQuery` API. "Rename" is
 * delete + re-create, which mints a new NamedQueryId. For v1 we take
 * the "names are immutable; delete-and-resave to rename" stance — the
 * route layer returns 405 on PATCH. See issue #9 for the v1.1 plan.
 *
 * Database default: when the caller omits `database`, fall back to
 * the workgroup's default (`scope.userDatabase` → `workspace_<user>`)
 * so saved queries bound to "run this in my own DB" round-trip cleanly.
 */

const LIST_PAGE_SIZE = 50;
const LIST_MAX_PAGES = 10;
const BATCH_GET_MAX = 50;

export async function createSavedQuery(
  client: AthenaClient,
  scope: AthenaScope,
  req: SaveQueryRequest
): Promise<{ id: string }> {
  const database = req.database ?? scope.userDatabase ?? scope.defaultDatabase ?? "";
  const out = await client.send(
    new CreateNamedQueryCommand({
      Name: req.name,
      Description: req.description,
      QueryString: req.sql,
      Database: database,
      WorkGroup: scope.workgroup,
    })
  );
  if (!out.NamedQueryId) {
    throw new Error("Athena did not return a NamedQueryId");
  }
  return { id: out.NamedQueryId };
}

export async function listSavedQueries(
  client: AthenaClient,
  scope: AthenaScope
): Promise<SavedQueriesPage> {
  const ids = await collectNamedQueryIds(client, scope.workgroup);
  if (ids.length === 0) return { items: [] };
  const details = await batchGetNamedQueries(client, ids);
  return {
    items: details.map(toSavedQuery),
  };
}

export async function deleteSavedQuery(
  client: AthenaClient,
  id: string
): Promise<void> {
  await client.send(new DeleteNamedQueryCommand({ NamedQueryId: id }));
}

// ---------------------------------------------------------------------------
// Internals

async function collectNamedQueryIds(
  client: AthenaClient,
  workgroup: string
): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const out = await client.send(
      new ListNamedQueriesCommand({
        WorkGroup: workgroup,
        MaxResults: LIST_PAGE_SIZE,
        NextToken: token,
      })
    );
    if (out.NamedQueryIds) ids.push(...out.NamedQueryIds);
    token = out.NextToken;
    if (!token) break;
  }
  return ids;
}

async function batchGetNamedQueries(
  client: AthenaClient,
  ids: string[]
): Promise<NamedQuery[]> {
  const out: NamedQuery[] = [];
  for (let i = 0; i < ids.length; i += BATCH_GET_MAX) {
    const batch = ids.slice(i, i + BATCH_GET_MAX);
    const res = await client.send(
      new BatchGetNamedQueryCommand({ NamedQueryIds: batch })
    );
    if (res.NamedQueries) out.push(...res.NamedQueries);
  }
  return out;
}

export function toSavedQuery(nq: NamedQuery): SavedQuery {
  return {
    id: nq.NamedQueryId ?? "",
    name: nq.Name ?? "",
    description: nq.Description,
    sql: nq.QueryString ?? "",
    database: nq.Database,
    workgroup: nq.WorkGroup,
  };
}
