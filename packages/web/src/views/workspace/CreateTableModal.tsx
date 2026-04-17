import { useEffect } from "react";

import type {
  AnalyzeResponse,
  DatasetColumn,
  DatasetFileType,
  Finding,
  S3Object,
} from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { useSchema } from "../../data/schemaContext";
import {
  narrowColumnIndices,
  runCreate,
  toggleOverride,
  type ButtonMode,
} from "./createTableActions";
import { FindingsPanel, type ResolveState } from "./FindingsPanel";
import "./FindingsPanel.css";
import { LocationSection } from "./LocationSection";
import "./LocationSection.css";
import "./CreateTableModal.css";
import { useCreateTableState } from "./useCreateTableState";

interface Props {
  file: S3Object;
  fileType: DatasetFileType;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTableModal(props: Props) {
  const { provider, context } = useAuth();
  const schema = useSchema();
  const s = useCreateTableState(provider, context ?? null, props.file, props.fileType);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !s.creating) props.onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [s.creating, props]);

  if (!context) return null;
  const database = context.athena.userDatabase ?? "workspace_unknown";

  const onCreate = () => {
    if (!s.analyze || !s.effectiveLocation) return;
    runCreate({
      provider,
      context,
      file: props.file,
      analyze: s.analyze,
      location: s.effectiveLocation,
      tableName: s.tableName,
      state: s.state,
      database,
      fileType: props.fileType,
      schema,
      setCreating: s.setCreating,
      setError: s.setError,
      onCreated: props.onCreated,
    });
  };

  return (
    <div className="ct-backdrop">
      <div className="ct-modal reg" role="dialog" aria-modal="true" data-testid="ct-modal">
        <ModalHeader onClose={props.onClose} disabled={s.creating} />
        <MetaHeader
          file={props.file}
          database={database}
          tableName={s.tableName}
          setTableName={s.setTableName}
          creating={s.creating}
        />
        {s.analyzing && <AnalyzingRow />}
        {!s.analyzing && s.analyze && s.effectiveLocation && (
          <ReviewBody
            analyze={s.analyze}
            effectiveLocation={s.effectiveLocation}
            file={props.file}
            state={s.state}
            setState={s.setState}
            columnIndexByName={s.columnIndexByName}
            creating={s.creating}
          />
        )}
        {s.error && <ErrorBlock message={s.error.message} />}
        <ModalFoot
          onClose={props.onClose}
          onCreate={onCreate}
          mode={s.buttonMode}
          creating={s.creating}
          disabled={isFootDisabled(s)}
        />
      </div>
    </div>
  );
}

function isFootDisabled(s: ReturnType<typeof useCreateTableState>): boolean {
  return (
    s.analyzing ||
    !s.analyze ||
    !s.effectiveLocation ||
    s.buttonMode === "blocked" ||
    s.tableName.trim().length === 0
  );
}

// ---------------------------------------------------------------------------
// Subcomponents

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

function MetaHeader({
  file,
  database,
  tableName,
  setTableName,
  creating,
}: {
  file: S3Object;
  database: string;
  tableName: string;
  setTableName: (v: string) => void;
  creating: boolean;
}) {
  return (
    <div className="ct-meta">
      <MetaRow label="source" value={file.name} />
      <MetaRow label="database" value={database} />
      <div className="ct-meta-row">
        <span className="tracked">table</span>
        <input
          className="input ct-table-input"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          disabled={creating}
        />
      </div>
    </div>
  );
}

function AnalyzingRow() {
  return (
    <div className="ct-inferring mono">
      <span className="dot" aria-hidden /> analyzing sample…
    </div>
  );
}

interface ReviewBodyProps {
  analyze: AnalyzeResponse;
  effectiveLocation: AnalyzeResponse["location"];
  file: S3Object;
  state: ResolveState;
  setState: React.Dispatch<React.SetStateAction<ResolveState>>;
  columnIndexByName: Record<string, number>;
  creating: boolean;
}

function ReviewBody({
  analyze,
  effectiveLocation,
  file,
  state,
  setState,
  columnIndexByName,
  creating,
}: ReviewBodyProps) {
  return (
    <>
      <LocationSection file={file} location={effectiveLocation} />
      <SchemaEditor
        columns={analyze.columns}
        overrides={state.stringOverrides}
        onToggleOverride={(i) => toggleOverride(setState, i)}
        disabled={creating}
      />
      <FindingsPanel
        findings={analyze.findings}
        columnIndexByName={columnIndexByName}
        state={state}
        onReplaceExistingToggle={(next) =>
          setState((ps) => ({ ...ps, replaceExisting: next }))
        }
        onOverrideColumn={(i) => toggleOverride(setState, i, true)}
        onAcceptNullFormat={(token) =>
          setState((ps) => ({ ...ps, acceptedNullFormat: token }))
        }
        onAcceptSerdeSwap={() => {
          // OpenCSVSerde can't natively store DATE/TIMESTAMP/BIGINT/DOUBLE
          // — force every non-string column to STRING on swap so the DDL
          // doesn't land with a definition Athena will choke on.
          const forced = narrowColumnIndices(analyze.columns);
          setState((ps) => ({
            ...ps,
            acceptedSerdeSwap: true,
            stringOverrides: new Set([...ps.stringOverrides, ...forced]),
          }));
        }}
        onDismiss={(k) =>
          setState((ps) => ({
            ...ps,
            dismissedAdvisoryKeys: new Set([...ps.dismissedAdvisoryKeys, k]),
          }))
        }
      />
    </>
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

interface SchemaEditorProps {
  columns: DatasetColumn[];
  overrides: Set<number>;
  onToggleOverride: (idx: number) => void;
  disabled: boolean;
}

function SchemaEditor({ columns, overrides, onToggleOverride, disabled }: SchemaEditorProps) {
  return (
    <div className="ct-schema">
      <div className="ct-schema-head">
        <span className="tracked">schema</span>
        <span className="text-dim mono">{columns.length} columns</span>
      </div>
      <ul className="ct-cols">
        {columns.map((col, idx) => (
          <SchemaRow
            key={idx}
            idx={idx}
            col={col}
            overridden={overrides.has(idx)}
            onToggle={() => onToggleOverride(idx)}
            disabled={disabled}
          />
        ))}
      </ul>
      <div className="ct-schema-foot text-muted mono">
        overridden columns get a companion view wrapping TRY_CAST so queries see the original type
      </div>
    </div>
  );
}

function SchemaRow({
  idx,
  col,
  overridden,
  onToggle,
  disabled,
}: {
  idx: number;
  col: DatasetColumn;
  overridden: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <li className={`ct-col-row ${overridden ? "ct-col-overridden" : ""}`}>
      <span className="ct-col-idx mono tnum">{String(idx + 1).padStart(2, "0")}</span>
      <span className="ct-col-name mono">{col.name}</span>
      <span className="ct-col-type mono">
        {overridden ? `string (was ${col.type})` : col.type}
      </span>
      <button className="btn btn-small" onClick={onToggle} disabled={disabled}>
        {overridden ? "restore" : "→ STRING"}
      </button>
    </li>
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
  mode: ButtonMode;
  creating: boolean;
  disabled: boolean;
}

function ModalFoot({ onClose, onCreate, mode, creating, disabled }: FootProps) {
  const label = creating
    ? "creating…"
    : mode === "blocked"
      ? "blocked"
      : mode === "advisory"
        ? "create anyway"
        : "create table";
  return (
    <div className="ct-foot flex-row gap-2">
      <button className="btn" onClick={onClose} disabled={creating}>
        cancel
      </button>
      <button
        className={`btn ${mode === "advisory" ? "btn-warn" : "btn-primary"} ml-auto`}
        onClick={onCreate}
        disabled={creating || disabled}
      >
        {label}
      </button>
    </div>
  );
}

// keep Finding exposed for external typing uses
export type { Finding };
