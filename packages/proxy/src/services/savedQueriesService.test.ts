import {
  BatchGetNamedQueryCommand,
  CreateNamedQueryCommand,
  DeleteNamedQueryCommand,
  ListNamedQueriesCommand,
  type AthenaClient,
} from "@aws-sdk/client-athena";
import { describe, expect, it } from "vitest";

import type { AthenaScope } from "@athena-shell/shared";

import {
  createSavedQuery,
  deleteSavedQuery,
  listSavedQueries,
  toSavedQuery,
} from "./savedQueriesService.js";

interface FakeResponse {
  NamedQueryId?: string;
  NamedQueryIds?: string[];
  NextToken?: string;
  NamedQueries?: unknown[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeClient(handler: (cmd: any) => FakeResponse): {
  client: AthenaClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calls: any[];
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any[] = [];
  const client = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    send: async (cmd: any) => {
      calls.push(cmd);
      return handler(cmd);
    },
  } as unknown as AthenaClient;
  return { client, calls };
}

const scope: AthenaScope = {
  workgroup: "workspace_alice",
  outputLocation: "s3://results/alice/",
  userDatabase: "workspace_alice",
  defaultDatabase: "default",
};

describe("createSavedQuery", () => {
  it("passes the scope's workgroup + name + sql through", async () => {
    const { client, calls } = fakeClient(() => ({ NamedQueryId: "nq-1" }));
    const out = await createSavedQuery(client, scope, {
      name: "daily",
      sql: "SELECT 1",
      database: "custom_db",
    });
    expect(out.id).toBe("nq-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(CreateNamedQueryCommand);
    expect(calls[0].input).toMatchObject({
      Name: "daily",
      QueryString: "SELECT 1",
      Database: "custom_db",
      WorkGroup: "workspace_alice",
    });
  });

  it("falls back to scope.userDatabase when database is omitted", async () => {
    const { client, calls } = fakeClient(() => ({ NamedQueryId: "nq-2" }));
    await createSavedQuery(client, scope, { name: "x", sql: "SELECT 1" });
    expect(calls[0].input.Database).toBe("workspace_alice");
  });

  it("falls back to scope.defaultDatabase when userDatabase is also missing", async () => {
    const { client, calls } = fakeClient(() => ({ NamedQueryId: "nq-3" }));
    const narrow: AthenaScope = {
      workgroup: "wg",
      outputLocation: "s3://r/",
      defaultDatabase: "default",
    };
    await createSavedQuery(client, narrow, { name: "x", sql: "SELECT 1" });
    expect(calls[0].input.Database).toBe("default");
  });

  it("throws when Athena omits NamedQueryId", async () => {
    const { client } = fakeClient(() => ({}));
    await expect(
      createSavedQuery(client, scope, { name: "x", sql: "SELECT 1" })
    ).rejects.toThrow(/NamedQueryId/);
  });
});

describe("listSavedQueries", () => {
  it("returns empty items when the workgroup has none", async () => {
    const { client } = fakeClient(() => ({ NamedQueryIds: [] }));
    const page = await listSavedQueries(client, scope);
    expect(page.items).toEqual([]);
  });

  it("paginates list calls and batches gets", async () => {
    let call = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { client, calls } = fakeClient((cmd: any) => {
      if (cmd instanceof ListNamedQueriesCommand) {
        call += 1;
        if (call === 1) return { NamedQueryIds: ["a", "b"], NextToken: "t" };
        return { NamedQueryIds: ["c"] };
      }
      if (cmd instanceof BatchGetNamedQueryCommand) {
        return {
          NamedQueries: (cmd.input.NamedQueryIds ?? []).map((id: string) => ({
            NamedQueryId: id,
            Name: `q-${id}`,
            QueryString: `SELECT ${id}`,
            WorkGroup: scope.workgroup,
          })),
        };
      }
      return {};
    });
    const page = await listSavedQueries(client, scope);
    expect(page.items.map((q) => q.id)).toEqual(["a", "b", "c"]);
    const listCalls = calls.filter((c) => c instanceof ListNamedQueriesCommand);
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1]?.input.NextToken).toBe("t");
  });
});

describe("deleteSavedQuery", () => {
  it("issues a DeleteNamedQueryCommand with the id", async () => {
    const { client, calls } = fakeClient(() => ({}));
    await deleteSavedQuery(client, "nq-xyz");
    expect(calls[0]).toBeInstanceOf(DeleteNamedQueryCommand);
    expect(calls[0].input.NamedQueryId).toBe("nq-xyz");
  });
});

describe("toSavedQuery", () => {
  it("maps Athena NamedQuery to SavedQuery shape", () => {
    const sq = toSavedQuery({
      NamedQueryId: "nq",
      Name: "n",
      Description: "d",
      QueryString: "SELECT 1",
      Database: "db",
      WorkGroup: "wg",
    });
    expect(sq).toEqual({
      id: "nq",
      name: "n",
      description: "d",
      sql: "SELECT 1",
      database: "db",
      workgroup: "wg",
    });
  });

  it("coerces missing fields to empty strings / undefined", () => {
    // Athena can return partial NamedQuery in error scenarios; the mapper
    // must be defensive. Cast the empty literal since NamedQuery requires
    // Name/Database/QueryString at the type level but not at runtime.
    const sq = toSavedQuery({} as Parameters<typeof toSavedQuery>[0]);
    expect(sq.id).toBe("");
    expect(sq.name).toBe("");
    expect(sq.sql).toBe("");
    expect(sq.description).toBeUndefined();
  });
});
