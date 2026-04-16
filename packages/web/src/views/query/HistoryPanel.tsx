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

  if (!items) return <LoadingSpinner label="History…" />;

  return (
    <div className="history">
      <div className="history-head">History</div>
      {items.length === 0 && <div className="text-muted text-sm history-empty">No queries yet.</div>}
      <ul className="history-list">
        {items.map((e) => (
          <li key={e.executionId} className="history-row flex-col gap-1">
            <button className="history-link" onClick={() => onSelect(e)}>
              <code className="truncate">{e.sql.replace(/\s+/g, " ").slice(0, 60)}</code>
            </button>
            <div className="flex-row gap-2 text-sm text-muted">
              <span className={`history-state state-${e.state.toLowerCase()}`}>{e.state}</span>
              <span>{formatRelative(e.submittedAt)}</span>
              <button
                className="history-fav ml-auto"
                aria-label={e.favorite ? "Unfavorite" : "Favorite"}
                onClick={async () => {
                  await toggleFavorite(e);
                  setItems((cur) =>
                    cur ? cur.map((x) => (x === e ? { ...x, favorite: !x.favorite } : x)) : cur
                  );
                }}
              >
                {e.favorite ? "★" : "☆"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
