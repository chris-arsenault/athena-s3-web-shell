import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Column, DatabaseRef, TableRef } from "@athena-shell/shared";

import { useAuth } from "../auth/authContext";
import { getTable, listDatabases, listTables } from "./schemaRepo";

export interface SchemaValue {
  databases: DatabaseRef[] | null;
  tablesByDb: Record<string, TableRef[]>;
  columnsByTable: Record<string, Column[]>;
  loadTables: (db: string) => Promise<TableRef[]>;
  loadColumns: (db: string, table: string) => Promise<Column[]>;
  /** Re-run the eager database + per-db tables fetch. Call after a
   *  mutation that adds/changes tables (e.g. CREATE TABLE). */
  refresh: () => Promise<void>;
}

const SchemaCtx = createContext<SchemaValue | null>(null);

export function SchemaProvider({ children }: { children: ReactNode }) {
  const value = useSchemaState();
  return <SchemaCtx.Provider value={value}>{children}</SchemaCtx.Provider>;
}

export function useSchema(): SchemaValue {
  const v = useContext(SchemaCtx);
  if (!v) throw new Error("useSchema must be used inside <SchemaProvider>");
  return v;
}

const CRAWL_CONCURRENCY = 4;

function useSchemaState(): SchemaValue {
  const { provider, context } = useAuth();
  const [databases, setDatabases] = useState<DatabaseRef[] | null>(null);
  const [tablesByDb, setTablesByDb] = useState<Record<string, TableRef[]>>({});
  const [columnsByTable, setColumnsByTable] = useState<Record<string, Column[]>>({});

  const tablesRef = useRef(tablesByDb);
  const columnsRef = useRef(columnsByTable);

  useEffect(() => {
    tablesRef.current = tablesByDb;
  }, [tablesByDb]);

  useEffect(() => {
    columnsRef.current = columnsByTable;
  }, [columnsByTable]);

  const refresh = useCallback(async (): Promise<void> => {
    const dbPage = await listDatabases(provider);
    setDatabases(dbPage.items);
    const results = await Promise.all(
      dbPage.items.map((db) =>
        listTables(provider, db.name).then((p) => [db.name, p.items] as const)
      )
    );
    const next = Object.fromEntries(results);
    tablesRef.current = next;
    setTablesByDb(next);
  }, [provider]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((err) => {
      if (!cancelled) console.error("[schema] eager load failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const loadTables = useCallback(
    async (db: string): Promise<TableRef[]> => {
      const cached = tablesRef.current[db];
      if (cached) return cached;
      const p = await listTables(provider, db);
      tablesRef.current = { ...tablesRef.current, [db]: p.items };
      setTablesByDb((s) => ({ ...s, [db]: p.items }));
      return p.items;
    },
    [provider]
  );

  const loadColumns = useCallback(
    async (db: string, table: string): Promise<Column[]> => {
      const key = `${db}.${table}`;
      const cached = columnsRef.current[key];
      if (cached) return cached;
      const detail = await getTable(provider, db, table);
      columnsRef.current = { ...columnsRef.current, [key]: detail.columns };
      setColumnsByTable((s) => ({ ...s, [key]: detail.columns }));
      return detail.columns;
    },
    [provider]
  );

  // Background crawl: once databases + tables are loaded, pre-warm
  // columns for every table in the user's workspace DB so autocomplete
  // responds without a per-table round-trip. Concurrency-capped so
  // GetTable calls don't stampede Glue. Silent on errors — the lazy
  // loadColumns path still works, this just saves a click.
  const userDb = context?.athena.userDatabase;
  const userDbTables = userDb ? tablesByDb[userDb] : undefined;
  useEffect(() => {
    if (!userDb || !userDbTables) return;
    const tok = { cancelled: false };
    void crawlColumns(tok, provider, userDb, userDbTables, loadColumns);
    return () => {
      tok.cancelled = true;
    };
  }, [provider, userDb, userDbTables, loadColumns]);

  return { databases, tablesByDb, columnsByTable, loadTables, loadColumns, refresh };
}

async function crawlColumns(
  tok: { cancelled: boolean },
  _provider: unknown,
  db: string,
  tables: readonly TableRef[],
  loadColumns: (db: string, table: string) => Promise<Column[]>
): Promise<void> {
  const queue = [...tables];
  const workers = Array.from({ length: Math.min(CRAWL_CONCURRENCY, queue.length) }, async () => {
    while (!tok.cancelled) {
      const next = queue.shift();
      if (!next) return;
      try {
        await loadColumns(db, next.name);
      } catch {
        // Let lazy-on-click retry; don't let one bad table kill the crawl.
      }
    }
  });
  await Promise.all(workers);
}
