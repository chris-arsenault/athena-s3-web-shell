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

function useSchemaState(): SchemaValue {
  const { provider } = useAuth();
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dbPage = await listDatabases(provider);
      if (cancelled) return;
      setDatabases(dbPage.items);
      const results = await Promise.all(
        dbPage.items.map((db) =>
          listTables(provider, db.name).then((p) => [db.name, p.items] as const)
        )
      );
      if (cancelled) return;
      setTablesByDb(Object.fromEntries(results));
    })().catch((err) => {
      console.error("[schema] eager load failed:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

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

  return { databases, tablesByDb, columnsByTable, loadTables, loadColumns };
}
