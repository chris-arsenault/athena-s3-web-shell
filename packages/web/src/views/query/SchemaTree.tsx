import { useEffect, useState } from "react";

import type { DatabaseRef, TableDetail, TableRef } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { getTable, listDatabases, listTables } from "../../data/schemaRepo";
import "./SchemaTree.css";

export function SchemaTree() {
  const { provider } = useAuth();
  const [dbs, setDbs] = useState<DatabaseRef[] | null>(null);
  const [openDb, setOpenDb] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, TableRef[]>>({});
  const [openTable, setOpenTable] = useState<string | null>(null);
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null);

  useEffect(() => {
    listDatabases(provider).then((p) => setDbs(p.items));
  }, [provider]);

  const toggleDb = async (name: string) => {
    if (openDb === name) {
      setOpenDb(null);
      return;
    }
    setOpenDb(name);
    if (!tables[name]) {
      const p = await listTables(provider, name);
      setTables((cur) => ({ ...cur, [name]: p.items }));
    }
  };

  const toggleTable = async (db: string, name: string) => {
    const key = `${db}.${name}`;
    if (openTable === key) {
      setOpenTable(null);
      return;
    }
    setOpenTable(key);
    const detail = await getTable(provider, db, name);
    setTableDetail(detail);
  };

  if (!dbs) return <LoadingSpinner label="Loading schema…" />;

  return (
    <div className="schema-tree">
      <div className="schema-head">Catalog</div>
      <ul className="tree-list">
        {dbs.map((db) => (
          <li key={db.name}>
            <button className="tree-row" onClick={() => toggleDb(db.name)}>
              <span>{openDb === db.name ? "▾" : "▸"}</span>
              <span>🗄️</span>
              <span className="truncate">{db.name}</span>
            </button>
            {openDb === db.name && (
              <ul className="tree-list tree-nested">
                {(tables[db.name] ?? []).map((t) => (
                  <li key={t.name}>
                    <button className="tree-row" onClick={() => toggleTable(db.name, t.name)}>
                      <span>
                        {openTable === `${db.name}.${t.name}` ? "▾" : "▸"}
                      </span>
                      <span>📋</span>
                      <span className="truncate">{t.name}</span>
                    </button>
                    {openTable === `${db.name}.${t.name}` && tableDetail && (
                      <ul className="tree-list tree-nested">
                        {tableDetail.columns.map((c) => (
                          <li key={c.name} className="tree-col flex-row gap-2">
                            <span>·</span>
                            <span className="truncate">{c.name}</span>
                            <span className="text-muted text-sm ml-auto">{c.type}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
