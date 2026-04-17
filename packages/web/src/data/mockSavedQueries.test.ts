import { afterEach, describe, expect, it } from "vitest";

import { mockSavedQueries } from "./mockSavedQueries";

afterEach(() => {
  mockSavedQueries._reset();
});

describe("mockSavedQueries", () => {
  it("create + list round-trips", async () => {
    const { id } = await mockSavedQueries.create("wg-a", "db_a", {
      name: "daily",
      sql: "SELECT 1",
    });
    const page = await mockSavedQueries.list("wg-a");
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(id);
    expect(page.items[0]?.name).toBe("daily");
    expect(page.items[0]?.database).toBe("db_a");
  });

  it("prefers explicit req.database over userDatabase fallback", async () => {
    await mockSavedQueries.create("wg-a", "db_a", {
      name: "q",
      sql: "SELECT 1",
      database: "db_explicit",
    });
    const page = await mockSavedQueries.list("wg-a");
    expect(page.items[0]?.database).toBe("db_explicit");
  });

  it("isolates queries by workgroup — alice cannot see bob's", async () => {
    await mockSavedQueries.create("wg-alice", "db_a", { name: "a1", sql: "SELECT 1" });
    await mockSavedQueries.create("wg-bob", "db_b", { name: "b1", sql: "SELECT 2" });
    const alice = await mockSavedQueries.list("wg-alice");
    const bob = await mockSavedQueries.list("wg-bob");
    expect(alice.items.map((q) => q.name)).toEqual(["a1"]);
    expect(bob.items.map((q) => q.name)).toEqual(["b1"]);
  });

  it("delete removes the entry", async () => {
    const { id } = await mockSavedQueries.create("wg-a", undefined, {
      name: "q",
      sql: "SELECT 1",
    });
    await mockSavedQueries.delete("wg-a", id);
    const page = await mockSavedQueries.list("wg-a");
    expect(page.items).toEqual([]);
  });
});
