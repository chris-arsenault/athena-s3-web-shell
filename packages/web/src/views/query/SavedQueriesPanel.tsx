import { useEffect, useState } from "react";

import type { SavedQuery } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { deleteSavedQuery, listSavedQueries } from "../../data/savedQueriesRepo";
import "./SavedQueriesPanel.css";

interface Props {
  refreshKey: string | number;
  onPick: (q: SavedQuery) => void;
  onChanged: () => void;
}

export function SavedQueriesPanel({ refreshKey, onPick, onChanged }: Props) {
  const { provider, context } = useAuth();
  const [items, setItems] = useState<SavedQuery[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setError(null);
    listSavedQueries(provider, context.athena.workgroup)
      .then((p) => {
        if (!cancelled) setItems(p.items);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, refreshKey]);

  if (!context) return null;

  const onDelete = async (q: SavedQuery) => {
    if (!confirm(`delete "${q.name}"?`)) return;
    await deleteSavedQuery(provider, context.athena.workgroup, q.id);
    onChanged();
  };

  return (
    <div className="lib" data-testid="saved-queries-panel">
      <div className="lib-head">
        <div className="tracked">Library</div>
        <span className="lib-count mono">
          {items ? String(items.length).padStart(2, "0") : "··"}
        </span>
      </div>
      <div className="lib-rule" aria-hidden />
      {error && (
        <div className="lib-err mono">
          <span className="tok tok-danger">fault</span>
          <span className="text-dim">{error}</span>
        </div>
      )}
      <LibraryBody items={items} onPick={onPick} onDelete={onDelete} />
    </div>
  );
}

interface BodyProps {
  items: SavedQuery[] | null;
  onPick: (q: SavedQuery) => void;
  onDelete: (q: SavedQuery) => void;
}

function LibraryBody({ items, onPick, onDelete }: BodyProps) {
  if (items === null) return <LoadingSpinner label="library" />;
  if (items.length === 0) {
    return (
      <div className="lib-empty mono text-muted">
        <span className="text-dim">∅ </span>no saved queries yet.
      </div>
    );
  }
  return (
    <ul className="lib-list">
      {items.map((q) => (
        <SavedRow key={q.id} q={q} onPick={onPick} onDelete={onDelete} />
      ))}
    </ul>
  );
}

interface RowProps {
  q: SavedQuery;
  onPick: (q: SavedQuery) => void;
  onDelete: (q: SavedQuery) => void;
}

function SavedRow({ q, onPick, onDelete }: RowProps) {
  return (
    <li className="lib-row" data-testid={`sq-row-${q.name}`}>
      <button className="lib-pick" onClick={() => onPick(q)}>
        <span className="lib-glyph" aria-hidden>◆</span>
        <span className="lib-name mono truncate">{q.name}</span>
        {q.description && (
          <span className="lib-desc truncate text-muted">{q.description}</span>
        )}
      </button>
      <button
        className="lib-del"
        onClick={() => onDelete(q)}
        aria-label={`delete ${q.name}`}
        data-testid={`sq-del-${q.name}`}
      >
        ×
      </button>
    </li>
  );
}
