import { useEffect, useState } from "react";

import type { QueryStatus } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { saveResultToWorkspace } from "../../data/queryResultsRepo";
import "./SaveResultModal.css";

interface Props {
  executionId: string;
  status: QueryStatus;
  onClose: () => void;
  onSaved: (targetKey: string) => void;
}

export function SaveResultModal({ executionId, status, onClose, onSaved }: Props) {
  const { provider, context } = useAuth();
  const form = useSaveForm(executionId, status.sql, context?.s3.prefix);
  useEscClose(onClose, form.saving);
  if (!context) return null;
  const targetKey = trailingSlash(form.prefix) + form.filename;
  const valid = isValidKey(context.s3.prefix, targetKey);

  const submit = async (overwrite: boolean) => {
    form.setError(null);
    form.setSaving(true);
    try {
      const out = await saveResultToWorkspace(provider, executionId, {
        targetKey,
        includeSqlSidecar: form.includeSqlSidecar,
        overwrite,
      });
      onSaved(out.key);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      if (err.code === "already_exists" || err.status === 409) {
        form.setOverwritePrompt(targetKey);
      } else {
        form.setError(err.message);
      }
      form.setSaving(false);
    }
  };

  return (
    <div className="sr-backdrop">
      <div className="sr-modal reg" role="dialog" aria-modal="true" data-testid="sr-modal">
        <Header onClose={onClose} disabled={form.saving} />
        <SourceRow executionId={executionId} status={status} />
        <Field label="target prefix" testid="sr-prefix" value={form.prefix} onChange={form.setPrefix} disabled={form.saving} />
        <Field label="target name" testid="sr-filename" value={form.filename} onChange={form.setFilename} disabled={form.saving} />
        <SidecarRow checked={form.includeSqlSidecar} onChange={form.setIncludeSqlSidecar} disabled={form.saving} />
        {form.error && <ErrorChip message={form.error} />}
        {form.overwritePrompt && (
          <OverwritePrompt
            targetKey={form.overwritePrompt}
            onCancel={() => form.setOverwritePrompt(null)}
            onConfirm={() => {
              form.setOverwritePrompt(null);
              void submit(true);
            }}
          />
        )}
        <Footer onClose={onClose} onSave={() => submit(false)} saving={form.saving} canSave={valid && !!form.filename.trim()} />
      </div>
    </div>
  );
}

function useSaveForm(executionId: string, sql: string, userPrefix: string | undefined) {
  const [prefix, setPrefix] = useState<string>(() =>
    userPrefix ? trailingSlash(userPrefix) + "results/" : ""
  );
  const [filename, setFilename] = useState<string>(defaultFilename(executionId, sql));
  const [includeSqlSidecar, setIncludeSqlSidecar] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overwritePrompt, setOverwritePrompt] = useState<string | null>(null);
  return {
    prefix,
    setPrefix,
    filename,
    setFilename,
    includeSqlSidecar,
    setIncludeSqlSidecar,
    saving,
    setSaving,
    error,
    setError,
    overwritePrompt,
    setOverwritePrompt,
  };
}

function Header({ onClose, disabled }: { onClose: () => void; disabled: boolean }) {
  return (
    <div className="sr-head">
      <span className="tok tok-accent">save to workspace</span>
      <span className="sr-head-rule" aria-hidden />
      <button className="sr-close" onClick={onClose} disabled={disabled}>
        [ X ]
      </button>
    </div>
  );
}

function SourceRow({ executionId, status }: { executionId: string; status: QueryStatus }) {
  return (
    <div className="sr-source mono text-muted">
      <span className="tracked">source</span>
      <span className="sr-source-val">
        <span className="text-dim">exec</span> {executionId.slice(0, 12)} ·
        {" "}
        {status.stats?.dataScannedBytes
          ? `${humanBytes(status.stats.dataScannedBytes)} scanned`
          : "completed"}
      </span>
    </div>
  );
}

function Field(props: {
  label: string;
  testid: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="sr-field">
      <span className="tracked">{props.label}</span>
      <input
        className="input sr-input"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        data-testid={props.testid}
      />
    </label>
  );
}

function SidecarRow(props: {
  checked: boolean;
  onChange: (b: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="sr-sidecar" data-testid="sr-sidecar">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
      />
      <span className="mono">save the SQL alongside as a <span className="tok">.sql</span> sidecar</span>
    </label>
  );
}

function ErrorChip({ message }: { message: string }) {
  return (
    <div className="sr-error">
      <span className="tok tok-danger">fault</span>
      <span className="mono sr-error-msg">{message}</span>
    </div>
  );
}

function OverwritePrompt(props: {
  targetKey: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="sr-overwrite" data-testid="sr-overwrite">
      <span className="tok tok-warn">exists</span>
      <span className="mono sr-error-msg">
        {props.targetKey} exists. overwrite?
      </span>
      <div className="flex-row gap-2">
        <button className="btn" onClick={props.onCancel}>
          cancel
        </button>
        <button
          className="btn btn-danger"
          onClick={props.onConfirm}
          data-testid="sr-overwrite-confirm"
        >
          overwrite
        </button>
      </div>
    </div>
  );
}

function Footer(props: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  return (
    <div className="sr-foot flex-row gap-2">
      <button className="btn" onClick={props.onClose} disabled={props.saving}>
        cancel
      </button>
      <button
        className="btn btn-primary ml-auto"
        onClick={props.onSave}
        disabled={props.saving || !props.canSave}
        data-testid="sr-save"
      >
        {props.saving ? "saving…" : "save"}
      </button>
    </div>
  );
}

function useEscClose(onClose: () => void, disabled: boolean): void {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disabled) onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose, disabled]);
}

function trailingSlash(p: string): string {
  return p.endsWith("/") ? p : p + "/";
}

function defaultFilename(executionId: string, sql: string): string {
  const slug = sql
    .split("\n")[0]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (slug && slug.length >= 3) return `${slug}.csv`;
  return `${executionId.slice(0, 16)}.csv`;
}

function isValidKey(userPrefix: string, key: string): boolean {
  if (!key.startsWith(userPrefix)) return false;
  if (key.includes("..")) return false;
  if (key.endsWith("/")) return false;
  return true;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
