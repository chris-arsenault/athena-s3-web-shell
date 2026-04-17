import { openDB } from "idb";
import { afterEach, describe, expect, it } from "vitest";

import { _resetForTests, drafts, favorites } from "./localDb";

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

describe("v2 migration", () => {
  it("drops the legacy namedQueries store on upgrade from v1", async () => {
    const v1 = await openDB("athena-shell", 1, {
      upgrade(db) {
        const d = db.createObjectStore("drafts", { keyPath: "id", autoIncrement: true });
        d.createIndex("updatedAt", "updatedAt");
        const f = db.createObjectStore("favorites", { keyPath: "id", autoIncrement: true });
        f.createIndex("executionId", "executionId", { unique: true });
        const n = db.createObjectStore("namedQueries", { keyPath: "id", autoIncrement: true });
        n.createIndex("name", "name", { unique: true });
      },
    });
    await v1.add("namedQueries", { name: "legacy", sql: "SELECT 1" });
    v1.close();

    await drafts.list();

    const v2 = await openDB("athena-shell", 2);
    expect(Array.from(v2.objectStoreNames)).not.toContain("namedQueries");
    expect(Array.from(v2.objectStoreNames)).toContain("drafts");
    expect(Array.from(v2.objectStoreNames)).toContain("favorites");
    v2.close();
  });
});
