import { afterEach, describe, expect, it } from "vitest";

import { _resetForTests, favorites, session, tabs } from "./localDb";

afterEach(async () => {
  await _resetForTests();
});

describe("favorites", () => {
  it("dedupes by executionId", async () => {
    await favorites.add("e1", "SELECT 1");
    await favorites.add("e1", "SELECT 1");
    expect((await favorites.list()).length).toBe(1);
  });
  it("removes by executionId", async () => {
    await favorites.add("e1", "SELECT 1");
    await favorites.remove("e1");
    expect((await favorites.list()).length).toBe(0);
  });
});

describe("tabs", () => {
  it("upserts + lists in order", async () => {
    await tabs.upsert({
      id: "a",
      name: "A",
      sql: "SELECT 1",
      order: 1,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    await tabs.upsert({
      id: "b",
      name: "B",
      sql: "SELECT 2",
      order: 0,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const list = await tabs.list();
    expect(list.map((t) => t.id)).toEqual(["b", "a"]);
  });
  it("upsert updates existing", async () => {
    await tabs.upsert({
      id: "a",
      name: "A",
      sql: "SELECT 1",
      order: 0,
      updatedAt: "x",
    });
    await tabs.upsert({
      id: "a",
      name: "A2",
      sql: "SELECT 2",
      order: 0,
      updatedAt: "y",
    });
    const list = await tabs.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.sql).toBe("SELECT 2");
  });
  it("remove deletes a tab", async () => {
    await tabs.upsert({
      id: "a",
      name: "A",
      sql: "",
      order: 0,
      updatedAt: "x",
    });
    await tabs.remove("a");
    expect(await tabs.list()).toEqual([]);
  });
});

describe("session", () => {
  it("round-trips key/value", async () => {
    await session.set("activeTabId", "tab-1");
    expect(await session.get("activeTabId")).toBe("tab-1");
  });
  it("returns null for unset keys", async () => {
    expect(await session.get("missing")).toBeNull();
  });
});
