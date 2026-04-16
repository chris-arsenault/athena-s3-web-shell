import { useState } from "react";

import type { Column, DatabaseRef, TableRef } from "@athena-shell/shared";

import { LoadingSpinner } from "../../components/LoadingSpinner";
import { useSchema } from "../../data/schemaContext";
import "./SchemaTree.css";

const NO_TABLES: TableRef[] = [];

export function SchemaTree() {
  const schema = useSchema();
  const [openDb, setOpenDb] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);

  const toggleDb = async (name: string) => {
    if (openDb === name) return setOpenDb(null);
    setOpenDb(name);
    await schema.loadTables(name);
  };

  const toggleTable = async (db: string, name: string) => {
    const key = `${db}.${name}`;
    if (openTable === key) return setOpenTable(null);
    setOpenTable(key);
    await schema.loadColumns(db, name);
  };

  if (!schema.databases) return <LoadingSpinner label="catalog" />;

  return (
    <div className="catalog">
      <div className="catalog-head">
        <div className="tracked">Catalog</div>
        <span className="catalog-count mono">
          {String(schema.databases.length).padStart(2, "0")}
        </span>
      </div>
      <div className="catalog-rule" aria-hidden />
      <ul className="tree-list">
        {schema.databases.map((db, i) => (
          <DbItem
            key={db.name}
            db={db}
            index={i + 1}
            open={openDb === db.name}
            tables={schema.tablesByDb[db.name] ?? NO_TABLES}
            onToggle={() => toggleDb(db.name)}
            openTableKey={openTable}
            columnsByTable={schema.columnsByTable}
            onToggleTable={toggleTable}
          />
        ))}
      </ul>
    </div>
  );
}

interface DbItemProps {
  db: DatabaseRef;
  index: number;
  open: boolean;
  tables: TableRef[];
  onToggle: () => void;
  openTableKey: string | null;
  columnsByTable: Record<string, Column[]>;
  onToggleTable: (db: string, name: string) => void;
}

function DbItem(p: DbItemProps) {
  return (
    <li className="tree-db">
      <button
        className={`tree-row tree-db-row ${p.open ? "is-open" : ""}`}
        onClick={p.onToggle}
      >
        <span className="tree-caret">{p.open ? "▾" : "▸"}</span>
        <span className="tree-idx">{String(p.index).padStart(2, "0")}</span>
        <span className="tree-kind">▣</span>
        <span className="truncate tree-name">{p.db.name}</span>
      </button>
      {p.open && (
        <ul className="tree-list tree-nested">
          {p.tables.map((t) => {
            const k = `${p.db.name}.${t.name}`;
            return (
              <TblItem
                key={t.name}
                table={t}
                open={p.openTableKey === k}
                columns={p.columnsByTable[k]}
                onToggle={() => p.onToggleTable(p.db.name, t.name)}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

interface TblItemProps {
  table: TableRef;
  open: boolean;
  columns?: Column[];
  onToggle: () => void;
}

function TblItem({ table, open, columns, onToggle }: TblItemProps) {
  return (
    <li>
      <button
        className={`tree-row tree-tbl-row ${open ? "is-open" : ""}`}
        onClick={onToggle}
      >
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
        <span className="tree-kind tree-kind-tbl">▤</span>
        <span className="truncate tree-name">{table.name}</span>
      </button>
      {open && columns && (
        <ul className="tree-list tree-cols">
          {columns.map((c) => (
            <ColItem key={c.name} column={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ColItem({ column }: { column: Column }) {
  return (
    <li className="tree-col">
      <span className="tree-col-rule" aria-hidden />
      <span className="tree-col-name truncate">{column.name}</span>
      <span className="tree-col-type">{column.type}</span>
    </li>
  );
}
