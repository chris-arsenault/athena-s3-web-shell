import { afterEach, describe, expect, it } from "vitest";

import { _resetForTests, drafts, favorites, namedQueries } from "./localDb";

afterEach(async () => {
  await _resetForTests();
});

describe("drafts", () => {
  it("saves and lists newest first", async () => {
    await drafts.save({ title: "a", sql: "SELECT 1", updatedAt: "2026-01-01T00:00:00Z" });
    await drafts.save({ title: "b", sql: "SELECT 2", updatedAt: "2026-02-01T00:00:00Z" });
    const list = await drafts.list();
    expect(list.map((d) => d.title)).toEqual(["b", "a"]);
  });
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

describe("namedQueries", () => {
  it("saves with timestamps", async () => {
    await namedQueries.save("daily", "SELECT count(*) FROM t");
    const list = await namedQueries.list();
    expect(list[0]?.name).toBe("daily");
    expect(list[0]?.createdAt).toBeTruthy();
  });
});
