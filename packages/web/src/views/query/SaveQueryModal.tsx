import { useEffect, useState } from "react";

import type { SaveQueryRequest } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { createSavedQuery } from "../../data/savedQueriesRepo";
import "./SaveQueryModal.css";

interface Props {
  sql: string;
  onClose: () => void;
  onSaved: () => void;
}

const NAME_PATTERN = /^[A-Za-z0-9 _-]{1,64}$/;

export function SaveQueryModal({ sql, onClose, onSaved }: Props) {
  const { provider, context } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [saving, onClose]);

  if (!context) return null;

  const workgroup = context.athena.workgroup;
  const database = context.athena.userDatabase;
  const trimmedName = name.trim();
  const valid = NAME_PATTERN.test(trimmedName) && sql.trim().length > 0;

  const onSubmit = async () => {
    setError(null);
    setSaving(true);
    try {
      const req: SaveQueryRequest = {
        name: trimmedName,
        description: description.trim() || undefined,
        sql,
        database,
      };
      await createSavedQuery(provider, { workgroup, userDatabase: database }, req);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sq-backdrop">
      <div className="sq-modal" role="dialog" aria-modal="true" data-testid="sq-modal">
        <ModalHeader onClose={onClose} disabled={saving} />
        <ModalMeta workgroup={workgroup} database={database} />
        <NameField value={name} onChange={setName} disabled={saving} valid={valid || !trimmedName} />
        <DescField value={description} onChange={setDescription} disabled={saving} />
        <SqlPreview sql={sql} />
        {error && <ErrorBlock message={error} />}
        <ModalFoot onClose={onClose} onSubmit={onSubmit} saving={saving} disabled={!valid} />
      </div>
    </div>
  );
}

function ModalHeader({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <div className="sq-head">
      <span className="tok tok-accent">save query</span>
      <span className="sq-head-rule" aria-hidden />
      <button className="sq-close" onClick={onClose} disabled={disabled}>
        [ X ]
      </button>
    </div>
  );
}

function ModalMeta({ workgroup, database }: { workgroup: string; database?: string }) {
  return (
    <div className="sq-meta">
      <MetaRow label="workgroup" value={workgroup} />
      <MetaRow label="database" value={database ?? "—"} />
      <div className="sq-note mono text-muted">
        <span className="text-dim">▸ </span>
        names are immutable. delete &amp; re-save to rename.
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="sq-meta-row">
      <span className="tracked">{label}</span>
      <span className="mono truncate">{value}</span>
    </div>
  );
}

interface NameProps {
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
  valid: boolean;
}

function NameField({ value, onChange, disabled, valid }: NameProps) {
  return (
    <label className="sq-field">
      <span className="tracked">name</span>
      <input
        className={`input sq-input ${!valid ? "is-invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="daily_revenue"
        maxLength={64}
        disabled={disabled}
        data-testid="sq-name-input"
      />
      <span className="sq-hint mono text-muted">
        {value.trim().length}/64 · letters, digits, space, underscore, hyphen
      </span>
    </label>
  );
}

interface DescProps {
  value: string;
  onChange: (s: string) => void;
  disabled: boolean;
}

function DescField({ value, onChange, disabled }: DescProps) {
  return (
    <label className="sq-field">
      <span className="tracked">description</span>
      <input
        className="input sq-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="optional summary"
        maxLength={200}
        disabled={disabled}
      />
    </label>
  );
}

function SqlPreview({ sql }: { sql: string }) {
  return (
    <div className="sq-preview">
      <div className="sq-preview-head">
        <span className="tracked">sql</span>
        <span className="mono text-dim">{sql.length} chars</span>
      </div>
      <pre className="sq-preview-body mono">{sql.trim() || "(empty)"}</pre>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="sq-error">
      <span className="tok tok-danger">fault</span>
      <span className="mono sq-error-msg">{message}</span>
    </div>
  );
}

interface FootProps {
  onClose: () => void;
  onSubmit: () => void;
  saving: boolean;
  disabled: boolean;
}

function ModalFoot({ onClose, onSubmit, saving, disabled }: FootProps) {
  return (
    <div className="sq-foot flex-row gap-2">
      <button className="btn" onClick={onClose} disabled={saving}>
        cancel
      </button>
      <button
        className="btn btn-primary ml-auto"
        onClick={onSubmit}
        disabled={saving || disabled}
        data-testid="sq-save-btn"
      >
        {saving ? "saving…" : "save"}
      </button>
    </div>
  );
}
