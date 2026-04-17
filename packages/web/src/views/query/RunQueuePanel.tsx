import type { QueueItem, QueueItemState } from "./useRunQueue";
import "./RunQueuePanel.css";

interface Props {
  queue: QueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunQueuePanel({ queue, selectedId, onSelect }: Props) {
  if (queue.length < 2) return null;
  return (
    <div className="rq" data-testid="run-queue">
      <div className="rq-head">
        <span className="tracked">Queue</span>
        <span className="rq-count mono">
          {String(queue.length).padStart(2, "0")}
        </span>
      </div>
      <ol className="rq-list">
        {queue.map((it, i) => (
          <QueueRow
            key={it.id}
            item={it}
            index={i + 1}
            selected={selectedId === it.id}
            onClick={() => onSelect(it.id)}
          />
        ))}
      </ol>
    </div>
  );
}

interface RowProps {
  item: QueueItem;
  index: number;
  selected: boolean;
  onClick: () => void;
}

function QueueRow({ item, index, selected, onClick }: RowProps) {
  return (
    <li
      className={`rq-row state-${item.state} ${selected ? "is-selected" : ""}`}
      data-testid={`rq-row-${index}`}
    >
      <button className="rq-pick" onClick={onClick}>
        <span className="rq-idx mono tnum">{String(index).padStart(2, "0")}</span>
        <span className={`tok tok-${tokClass(item.state)}`}>{item.state}</span>
        <span className="rq-sql mono truncate">{preview(item.sql)}</span>
      </button>
    </li>
  );
}

function preview(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 96);
}

function tokClass(state: QueueItemState): "live" | "warn" | "danger" | "info" {
  if (state === "succeeded") return "live";
  if (state === "running" || state === "pending") return "warn";
  if (state === "failed" || state === "cancelled") return "danger";
  return "info";
}
