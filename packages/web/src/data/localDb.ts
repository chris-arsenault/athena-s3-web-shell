import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "athena-shell";
// v3: swaps the old `drafts` store for `tabs` + `session`. Backs #10
// (multi-tab persistence). No migration — there was no deployed data.
const DB_VERSION = 3;

export interface Favorite {
  id: number;
  executionId: string;
  sql: string;
  savedAt: string;
}

export interface TabScratchpadSource {
  kind: "scratchpad";
  key: string;
  etag?: string;
}

export interface TabRecord {
  id: string;
  name: string;
  sql: string;
  database?: string;
  lastExecutionId?: string;
  order: number;
  updatedAt: string;
  source?: TabScratchpadSource;
  savedSql?: string;
}

export interface SessionEntry {
  key: string;
  value: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const fav = db.createObjectStore("favorites", {
            keyPath: "id",
            autoIncrement: true,
          });
          fav.createIndex("executionId", "executionId", { unique: true });
        }
        if (oldVersion < 2 && db.objectStoreNames.contains("namedQueries")) {
          db.deleteObjectStore("namedQueries");
        }
        if (oldVersion < 3) {
          if (db.objectStoreNames.contains("drafts")) db.deleteObjectStore("drafts");
          const tabs = db.createObjectStore("tabs", { keyPath: "id" });
          tabs.createIndex("order", "order");
          db.createObjectStore("session", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

export const favorites = {
  async list(): Promise<Favorite[]> {
    const db = await getDb();
    return (await db.getAll("favorites")) as Favorite[];
  },
  async add(executionId: string, sql: string): Promise<void> {
    const db = await getDb();
    const existing = await db.getFromIndex("favorites", "executionId", executionId);
    if (existing) return;
    await db.add("favorites", { executionId, sql, savedAt: new Date().toISOString() });
  },
  async remove(executionId: string): Promise<void> {
    const db = await getDb();
    const existing = (await db.getFromIndex("favorites", "executionId", executionId)) as
      | Favorite
      | undefined;
    if (!existing) return;
    await db.delete("favorites", existing.id);
  },
};

export const tabs = {
  async list(): Promise<TabRecord[]> {
    const db = await getDb();
    const all = (await db.getAllFromIndex("tabs", "order")) as TabRecord[];
    return all;
  },
  async upsert(rec: TabRecord): Promise<void> {
    const db = await getDb();
    await db.put("tabs", rec);
  },
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.delete("tabs", id);
  },
  async clear(): Promise<void> {
    const db = await getDb();
    await db.clear("tabs");
  },
};

export const session = {
  async get(key: string): Promise<string | null> {
    const db = await getDb();
    const e = (await db.get("session", key)) as SessionEntry | undefined;
    return e?.value ?? null;
  },
  async set(key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.put("session", { key, value });
  },
  async remove(key: string): Promise<void> {
    const db = await getDb();
    await db.delete("session", key);
  },
};

export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
  await indexedDB.deleteDatabase(DB_NAME);
}
