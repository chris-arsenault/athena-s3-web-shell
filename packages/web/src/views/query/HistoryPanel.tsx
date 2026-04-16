import { useEffect, useState } from "react";

import type { HistoryEntry } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { listHistory, toggleFavorite } from "../../data/historyRepo";
import { formatRelative } from "../../utils/formatDate";
import "./HistoryPanel.css";

interface Props {
  refreshKey: string;
  onSelect: (entry: HistoryEntry) => void;
}

export function HistoryPanel({ refreshKey, onSelect }: Props) {
  const { provider } = useAuth();
  const [items, setItems] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listHistory(provider).then((p) => {
      if (!cancelled) setItems(p.items);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, refreshKey]);

  if (!items) return <LoadingSpinner label="history" />;

  return (
    <div className="log">
      <div className="log-head">
        <div className="tracked">Journal</div>
        <span className="log-count mono">
          {String(items.length).padStart(3, "0")}
        </span>
      </div>
      <div className="log-rule" aria-hidden />
      {items.length === 0 && (
        <div className="log-empty mono text-muted">
          <span className="text-dim">∅ </span>No executions on record.
        </div>
      )}
      <ol className="log-list">
        {items.map((e, i) => (
          <li key={e.executionId} className={`log-entry state-${e.state.toLowerCase()}`}>
            <div className="log-gutter mono">
              <span className="log-line">{String(i + 1).padStart(3, "0")}</span>
              <span className="log-rail" aria-hidden />
            </div>
            <div className="log-body flex-col gap-1">
              <button className="log-sql mono" onClick={() => onSelect(e)}>
                <code className="truncate">
                  {e.sql.replace(/\s+/g, " ").trim().slice(0, 72)}
                </code>
              </button>
              <div className="log-meta flex-row gap-2">
                <span className={`tok tok-${stateTok(e.state)}`}>{e.state}</span>
                <span className="log-time mono text-muted">{formatRelative(e.submittedAt)}</span>
                <button
                  className={`log-fav ml-auto ${e.favorite ? "is-fav" : ""}`}
                  aria-label={e.favorite ? "Unpin" : "Pin"}
                  onClick={async () => {
                    await toggleFavorite(e);
                    setItems((cur) =>
                      cur
                        ? cur.map((x) => (x === e ? { ...x, favorite: !x.favorite } : x))
                        : cur
                    );
                  }}
                >
                  {e.favorite ? "★" : "☆"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function stateTok(state: string): "live" | "warn" | "danger" | "info" {
  const s = state.toLowerCase();
  if (s === "succeeded") return "live";
  if (s === "running" || s === "queued") return "warn";
  if (s === "failed" || s === "cancelled") return "danger";
  return "info";
}
