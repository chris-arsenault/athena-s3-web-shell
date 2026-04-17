import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "athena-shell";
// v2: drops the legacy `namedQueries` store. Saved queries now live in Athena
// (workgroup-scoped) via the proxy; keeping a parallel IndexedDB copy would
// drift.
const DB_VERSION = 2;

export interface Draft {
  id: number;
  title: string;
  sql: string;
  updatedAt: string;
}

export interface Favorite {
  id: number;
  executionId: string;
  sql: string;
  savedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const drafts = db.createObjectStore("drafts", { keyPath: "id", autoIncrement: true });
          drafts.createIndex("updatedAt", "updatedAt");
          const favorites = db.createObjectStore("favorites", { keyPath: "id", autoIncrement: true });
          favorites.createIndex("executionId", "executionId", { unique: true });
        }
        if (oldVersion < 2 && db.objectStoreNames.contains("namedQueries")) {
          db.deleteObjectStore("namedQueries");
        }
      },
    });
  }
  return dbPromise;
}

export const drafts = {
  async list(): Promise<Draft[]> {
    const db = await getDb();
    return (await db.getAllFromIndex("drafts", "updatedAt")).reverse() as Draft[];
  },
  async save(draft: Omit<Draft, "id">): Promise<number> {
    const db = await getDb();
    return (await db.add("drafts", draft)) as number;
  },
  async update(id: number, patch: Partial<Draft>): Promise<void> {
    const db = await getDb();
    const cur = (await db.get("drafts", id)) as Draft | undefined;
    if (!cur) return;
    await db.put("drafts", { ...cur, ...patch });
  },
  async remove(id: number): Promise<void> {
    const db = await getDb();
    await db.delete("drafts", id);
  },
};

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

export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbPromise = null;
  await indexedDB.deleteDatabase(DB_NAME);
}
