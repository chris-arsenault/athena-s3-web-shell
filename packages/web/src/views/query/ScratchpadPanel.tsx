import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../auth/authContext";
import {
  deleteScratchpad,
  listScratchpadFiles,
  renameScratchpad,
  scratchpadPrefix,
  writeScratchpad,
  type ScratchpadFile,
} from "../../data/scratchpadRepo";
import "./ScratchpadPanel.css";

interface Props {
  refreshKey: number;
  onOpen: (key: string, name: string) => void;
  onChanged: () => void;
}

export function ScratchpadPanel({ refreshKey, onOpen, onChanged }: Props) {
  const { context } = useAuth();
  const state = useScratchpadState(refreshKey, onOpen, onChanged);
  if (!context) return null;

  return (
    <div className="sp" data-testid="scratchpad-panel">
      <div className="sp-head">
        <span className="tracked">Scratchpad</span>
        <span className="sp-count mono">
          {state.files ? String(state.files.length).padStart(2, "0") : "··"}
        </span>
      </div>
      <div className="sp-rule" aria-hidden />
      <NewFileRow
        newName={state.newName}
        setNewName={state.setNewName}
        onCreate={state.createFile}
      />
      {state.error && <div className="sp-err mono">{state.error}</div>}
      <ListBody state={state} onOpen={onOpen} />
    </div>
  );
}

function NewFileRow({
  newName,
  setNewName,
  onCreate,
}: {
  newName: string;
  setNewName: (s: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="sp-new">
      <input
        className="input sp-new-input"
        placeholder="new-file.sql"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCreate();
        }}
        data-testid="sp-new-input"
      />
      <button
        className="btn sp-new-btn"
        onClick={onCreate}
        disabled={!newName.trim()}
        data-testid="sp-new-btn"
      >
        +
      </button>
    </div>
  );
}

function ListBody({
  state,
  onOpen,
}: {
  state: ReturnType<typeof useScratchpadState>;
  onOpen: (key: string, name: string) => void;
}) {
  if (state.files === null) return <div className="sp-status mono text-dim">loading…</div>;
  if (state.files.length === 0) {
    return (
      <div className="sp-empty mono text-muted">
        <span className="text-dim">∅ </span>no scratchpad files yet.
      </div>
    );
  }
  return (
    <ul className="sp-list">
      {state.files.map((f) => (
        <FileRow
          key={f.key}
          file={f}
          renaming={state.renaming?.key === f.key ? state.renaming.value : null}
          onStartRename={() => state.setRenaming({ key: f.key, value: f.name })}
          onChangeRename={(v) => state.setRenaming({ key: f.key, value: v })}
          onCommitRename={state.commitRename}
          onCancelRename={() => state.setRenaming(null)}
          onOpen={() => onOpen(f.key, f.name)}
          onDelete={() => state.onDelete(f)}
        />
      ))}
    </ul>
  );
}

function useScratchpadState(
  refreshKey: number,
  onOpen: (key: string, name: string) => void,
  onChanged: () => void
) {
  const { provider, context } = useAuth();
  const [files, setFiles] = useState<ScratchpadFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setError(null);
    listScratchpadFiles(provider, context)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, refreshKey]);

  const createFile = async () => {
    if (!context) return;
    const name = sanitizedName(newName);
    if (!name) return;
    const root = scratchpadPrefix(context);
    try {
      await writeScratchpad(provider, context, root + name, "");
      setNewName("");
      onChanged();
      onOpen(root + name, name);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const commitRename = async () => {
    if (!context || !renaming) return;
    const targetName = sanitizedName(renaming.value);
    if (!targetName) return;
    try {
      await renameScratchpad(provider, context, renaming.key, scratchpadPrefix(context) + targetName);
      setRenaming(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const onDelete = async (f: ScratchpadFile) => {
    if (!context) return;
    if (!confirm(`delete ${f.name}?`)) return;
    try {
      await deleteScratchpad(provider, context, f.key);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return {
    files,
    error,
    newName,
    setNewName,
    renaming,
    setRenaming,
    createFile,
    commitRename,
    onDelete,
  };
}

interface RowProps {
  file: ScratchpadFile;
  renaming: string | null;
  onStartRename: () => void;
  onChangeRename: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onDelete: () => void;
}

function FileRow(p: RowProps) {
  if (p.renaming !== null) {
    return <RenameRow p={p} />;
  }
  return (
    <li className="sp-row" data-testid={`sp-row-${p.file.name}`}>
      <button className="sp-open" onClick={p.onOpen}>
        <span className="sp-glyph" aria-hidden>»</span>
        <span className="sp-name mono truncate">{p.file.name}</span>
      </button>
      <button
        className="sp-act"
        onClick={p.onStartRename}
        aria-label={`rename ${p.file.name}`}
        data-testid={`sp-rename-btn-${p.file.name}`}
      >
        ✎
      </button>
      <button
        className="sp-act sp-act-del"
        onClick={p.onDelete}
        aria-label={`delete ${p.file.name}`}
        data-testid={`sp-del-${p.file.name}`}
      >
        ×
      </button>
    </li>
  );
}

function RenameRow({ p }: { p: RowProps }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.select();
  }, []);
  return (
    <li className="sp-row" data-testid={`sp-row-${p.file.name}`}>
      <input
        ref={inputRef}
        className="input sp-rename"
        value={p.renaming ?? ""}
        onChange={(e) => p.onChangeRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") p.onCommitRename();
          if (e.key === "Escape") p.onCancelRename();
        }}
        onBlur={p.onCommitRename}
        data-testid={`sp-rename-${p.file.name}`}
      />
    </li>
  );
}

function sanitizedName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withExt = trimmed.endsWith(".sql") ? trimmed : trimmed + ".sql";
  if (withExt.includes("..")) return null;
  if (!/^[A-Za-z0-9_./-]+\.sql$/.test(withExt)) return null;
  return withExt;
}
