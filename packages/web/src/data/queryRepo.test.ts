import { describe, expect, it } from "vitest";

import type { QueryResultPage } from "@athena-shell/shared";

import { MockAuthProvider } from "../auth/MockAuthProvider";
import { mockAthena } from "./mockAthena";
import { fetchAllResultsDirect, startQuery } from "./queryRepo";

const provider = new MockAuthProvider();

describe("fetchAllResultsDirect — mock path", () => {
  it("returns all rows in a single call (no pagination)", async () => {
    const { executionId } = await startQuery(provider, { sql: "SELECT *" });
    const firstPage = await mockAthena.getResults(executionId);
    const all = await fetchAllResultsDirect(provider, executionId, firstPage);
    expect(all).not.toBeNull();
    // mockAthena seeds 300 rows for non-COUNT queries. All rows should
    // come back in one shot — not paginated 100 at a time.
    expect(all!.rows.length).toBe(300);
    expect(all!.nextToken).toBeUndefined();
    expect(all!.columns).toEqual(firstPage.columns);
  });

  it("preserves first-page column shape", async () => {
    const { executionId } = await startQuery(provider, { sql: "SELECT count(*)" });
    const firstPage: QueryResultPage = {
      columns: [{ name: "count", type: "bigint" }],
      rows: [],
    };
    const all = await fetchAllResultsDirect(provider, executionId, firstPage);
    expect(all).not.toBeNull();
    expect(all!.columns).toEqual(firstPage.columns);
  });

  it("throws for an unknown executionId (mock parity with real path)", async () => {
    await expect(
      fetchAllResultsDirect(provider, "nonexistent", {
        columns: [],
        rows: [],
      })
    ).rejects.toThrow(/nonexistent/);
  });
});
