import { useEffect, useState } from "react";

import {
  QUERY_POLL_INTERVAL_MS,
  type AuthContext,
  type DatasetColumn,
  type DatasetFileType,
  type S3Object,
} from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { useAuth } from "../../auth/authContext";
import { createTable, inferSchema } from "../../data/datasetsRepo";
import { getQuery } from "../../data/queryRepo";
import "./CreateTableModal.css";

interface Props {
  file: S3Object;
  fileType: DatasetFileType;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTableModal({ file, fileType, onClose, onCreated }: Props) {
  const { provider, context } = useAuth();
  const [columns, setColumns] = useState<DatasetColumn[]>([]);
  const [tableName, setTableName] = useState(() => defaultTableName(file.name));
  const [inferring, setInferring] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!context) return;
    return runInfer(provider, context, file, fileType, setColumns, setError, setInferring);
  }, [provider, context, file, fileType]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creating) onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [creating, onClose]);

  if (!context) return null;
  const location = `s3://${context.s3.bucket}/${folderOf(file.key)}`;
  const database = context.athena.userDatabase ?? "workspace_unknown";

  const onCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const { executionId } = await createTable(provider, {
        database,
        table: tableName,
        location,
        fileType,
        columns,
        skipHeader: true,
      });
      await pollDdl(provider, executionId);
      onCreated();
    } catch (e) {
      setError(e as Error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ct-backdrop">
      <div className="ct-modal reg" role="dialog" aria-modal="true">
        <ModalHeader onClose={onClose} disabled={creating} />
        <ModalMeta
          file={file}
          database={database}
          location={location}
          tableName={tableName}
          setTableName={setTableName}
          disabled={creating}
        />
        <SchemaSection
          inferring={inferring}
          columns={columns}
          onChange={setColumns}
          disabled={creating}
        />
        {error && <ErrorBlock message={error.message} />}
        <ModalFoot
          onClose={onClose}
          onCreate={onCreate}
          creating={creating}
          inferring={inferring}
          disabled={columns.length === 0 || !tableName.trim()}
        />
      </div>
    </div>
  );
}

function runInfer(
  provider: AuthProvider,
  context: AuthContext,
  file: S3Object,
  fileType: DatasetFileType,
  setColumns: (c: DatasetColumn[]) => void,
  setError: (e: Error | null) => void,
  setInferring: (b: boolean) => void
): () => void {
  let cancelled = false;
  (async () => {
    try {
      const resp = await inferSchema(provider, {
        bucket: context.s3.bucket,
        key: file.key,
        fileType,
      });
      if (cancelled) return;
      setColumns(
        resp.columns.length > 0 ? resp.columns : [{ name: "col_1", type: "string" }]
      );
    } catch (e) {
      if (!cancelled) setError(e as Error);
    } finally {
      if (!cancelled) setInferring(false);
    }
  })();
  return () => {
    cancelled = true;
  };
}

// ---------------------------------------------------------------------------
// Modal subsections

function ModalHeader({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <div className="ct-head">
      <span className="tok tok-accent">register table</span>
      <span className="ct-head-rule" aria-hidden />
      <button className="ct-close" onClick={onClose} disabled={disabled}>
        [ X ]
      </button>
    </div>
  );
}

interface MetaProps {
  file: S3Object;
  database: string;
  location: string;
  tableName: string;
  setTableName: (s: string) => void;
  disabled: boolean;
}

function ModalMeta({ file, database, location, tableName, setTableName, disabled }: MetaProps) {
  return (
    <div className="ct-meta">
      <MetaRow label="source" value={file.name} />
      <MetaRow label="location" value={location} />
      <MetaRow label="database" value={database} />
      <div className="ct-meta-row">
        <span className="tracked">table</span>
        <input
          className="input ct-table-input"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ct-meta-row">
      <span className="tracked">{label}</span>
      <span className="mono truncate">{value}</span>
    </div>
  );
}

interface SchemaSectionProps {
  inferring: boolean;
  columns: DatasetColumn[];
  onChange: (next: DatasetColumn[]) => void;
  disabled: boolean;
}

function SchemaSection({ inferring, columns, onChange, disabled }: SchemaSectionProps) {
  return (
    <div className="ct-schema">
      <div className="ct-schema-head">
        <span className="tracked">schema</span>
        <span className="text-dim mono">{columns.length} columns</span>
      </div>
      {inferring ? (
        <div className="ct-schema-inferring mono">
          <span className="dot" aria-hidden /> inferring from sample…
        </div>
      ) : (
        <ColumnEditor columns={columns} onChange={onChange} disabled={disabled} />
      )}
    </div>
  );
}

interface ColumnEditorProps {
  columns: DatasetColumn[];
  onChange: (next: DatasetColumn[]) => void;
  disabled: boolean;
}

function ColumnEditor({ columns, onChange, disabled }: ColumnEditorProps) {
  const update = (idx: number, patch: Partial<DatasetColumn>) =>
    onChange(columns.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  return (
    <ul className="ct-cols">
      {columns.map((col, idx) => (
        <li key={idx} className="ct-col-row">
          <span className="ct-col-idx mono tnum">
            {String(idx + 1).padStart(2, "0")}
          </span>
          <input
            className="input ct-col-name"
            value={col.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            disabled={disabled}
          />
          <select
            className="input ct-col-type"
            value={col.type.replace(/\(.*/, "")}
            onChange={(e) => update(idx, { type: e.target.value })}
            disabled={disabled}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="ct-error">
      <span className="tok tok-danger">fault</span>
      <span className="mono ct-error-msg">{message}</span>
    </div>
  );
}

interface FootProps {
  onClose: () => void;
  onCreate: () => void;
  creating: boolean;
  inferring: boolean;
  disabled: boolean;
}

function ModalFoot({ onClose, onCreate, creating, inferring, disabled }: FootProps) {
  return (
    <div className="ct-foot flex-row gap-2">
      <button className="btn" onClick={onClose} disabled={creating}>
        cancel
      </button>
      <button
        className="btn btn-primary ml-auto"
        onClick={onCreate}
        disabled={creating || inferring || disabled}
      >
        {creating ? "creating…" : "create table"}
      </button>
    </div>
  );
}

const TYPES = [
  "string",
  "bigint",
  "int",
  "double",
  "decimal",
  "boolean",
  "date",
  "timestamp",
];

async function pollDdl(provider: AuthProvider, executionId: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const status = await getQuery(provider, executionId);
    if (status.state === "SUCCEEDED") return;
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(status.stateChangeReason ?? `Table creation ${status.state}`);
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for table creation");
    }
    await new Promise((r) => setTimeout(r, QUERY_POLL_INTERVAL_MS));
  }
}

function defaultTableName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const cleaned = stem.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) return "dataset";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function folderOf(key: string): string {
  const idx = key.lastIndexOf("/");
  return idx === -1 ? "" : key.slice(0, idx + 1);
}
