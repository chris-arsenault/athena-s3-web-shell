import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Column, DatabaseRef, TableRef } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { useSchema } from "../../data/schemaContext";
import { locationToPrefix } from "../../utils/locationToPrefix";
import "./SchemaTree.css";

const NO_TABLES: TableRef[] = [];

interface SchemaTreeProps {
  onPeekTable?: (db: string, table: string) => void;
}

export function SchemaTree({ onPeekTable }: SchemaTreeProps = {}) {
  const schema = useSchema();
  const { context } = useAuth();
  const [openDb, setOpenDb] = useState<string | null>(null);
  const [openTable, setOpenTable] = useState<string | null>(null);

  // Auto-expand the user's workspace DB on first sight — their tables
  // are what they're almost certainly looking for, so saving the click
  // to open the right DB is the right default.
  const userDb = context?.athena.userDatabase;
  if (schema.databases && userDb && openDb === null) {
    const hasUserDb = schema.databases.some((d) => d.name === userDb);
    if (hasUserDb) {
      setOpenDb(userDb);
      void schema.loadTables(userDb);
    }
  }

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
            onPeekTable={onPeekTable}
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
  onPeekTable?: (db: string, name: string) => void;
}

function DbItem(p: DbItemProps) {
  return (
    <li className="tree-db">
      <button
        className={`tree-row tree-db-row ${p.open ? "is-open" : ""}`}
        onClick={p.onToggle}
        data-testid={`tree-db-${p.db.name}`}
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
                db={p.db.name}
                table={t}
                open={p.openTableKey === k}
                columns={p.columnsByTable[k]}
                onToggle={() => p.onToggleTable(p.db.name, t.name)}
                onPeek={p.onPeekTable}
              />
            );
          })}
        </ul>
      )}
    </li>
  );
}

interface TblItemProps {
  db: string;
  table: TableRef;
  open: boolean;
  columns?: Column[];
  onToggle: () => void;
  onPeek?: (db: string, name: string) => void;
}

function TblItem({ db, table, open, columns, onToggle, onPeek }: TblItemProps) {
  return (
    <li>
      <div className={`tree-row tree-tbl-row ${open ? "is-open" : ""}`}>
        <button
          className="tree-row-pick"
          onClick={onToggle}
          onDoubleClick={() => onPeek?.(db, table.name)}
          data-testid={`tree-tbl-${db}-${table.name}`}
          title="Click to expand columns · double-click to peek (SELECT * LIMIT 10)"
        >
          <span className="tree-caret">{open ? "▾" : "▸"}</span>
          <span className="tree-kind tree-kind-tbl">▤</span>
          <span className="truncate tree-name">{table.name}</span>
        </button>
        <button
          className="tree-peek"
          onClick={(e) => {
            e.stopPropagation();
            onPeek?.(db, table.name);
          }}
          aria-label={`Peek ${db}.${table.name}`}
          title={`Peek: SELECT * FROM ${db}.${table.name} LIMIT 10`}
          data-testid={`tree-peek-${db}-${table.name}`}
        >
          ▶
        </button>
        <WorkspaceLink table={table} />
      </div>
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

function WorkspaceLink({ table }: { table: TableRef }) {
  const { context } = useAuth();
  const navigate = useNavigate();
  if (!context) return null;
  const loc = locationToPrefix(table.location);
  if (!loc) return null;
  if (loc.bucket !== context.s3.bucket) return null;
  if (!loc.prefix.startsWith(context.s3.prefix)) return null;
  return (
    <button
      className="tree-crosslink"
      title={`Browse backing files: ${loc.prefix}`}
      aria-label={`Browse ${table.database}.${table.name} in workspace`}
      data-testid={`tree-link-workspace-${table.database}-${table.name}`}
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/workspace?prefix=${encodeURIComponent(loc.prefix)}`);
      }}
    >
      ⇡
    </button>
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
