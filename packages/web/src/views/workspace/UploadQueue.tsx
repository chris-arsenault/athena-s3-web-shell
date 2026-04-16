import type { UploadProgress } from "@athena-shell/shared";

import { formatBytes } from "../../utils/formatBytes";
import "./UploadQueue.css";

interface Props {
  items: UploadProgress[];
  onClear: () => void;
}

export function UploadQueue({ items, onClear }: Props) {
  const allDone = items.every((i) => i.status === "succeeded" || i.status === "failed");
  const done = items.filter((i) => i.status === "succeeded").length;
  return (
    <div className="uq reg">
      <div className="uq-head flex-row gap-3">
        <span className="tracked">Transfer Queue</span>
        <span className="tok tok-accent">
          {String(done).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
        </span>
        <span className="uq-rule" aria-hidden />
        {allDone && (
          <button className="btn btn-ghost ml-auto" onClick={onClear}>
            clear
          </button>
        )}
      </div>
      <ul className="uq-list">
        {items.map((item) => {
          const pct = item.size === 0 ? 100 : Math.round((item.uploaded / item.size) * 100);
          return (
            <li key={item.id} className={`uq-row status-${item.status}`}>
              <div className="uq-row-top flex-row gap-2">
                <span className="uq-pct mono tnum">{String(pct).padStart(3, " ")}%</span>
                <span className="truncate flex-1 uq-name">{item.filename}</span>
                <span className="text-muted mono tnum uq-size">{formatBytes(item.size)}</span>
                <span className={`tok tok-${uqTok(item.status)} uq-stat`}>{item.status}</span>
              </div>
              <div className="uq-bar" data-pct={pct}>
                {/* eslint-disable-next-line local/no-inline-styles */}
                <span className="uq-bar-fill" style={{ width: `${pct}%` }} />
                <span className="uq-bar-ticks" aria-hidden />
              </div>
              {item.error && <span className="uq-err mono">{item.error}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function uqTok(status: UploadProgress["status"]): "live" | "warn" | "danger" | "info" {
  if (status === "succeeded") return "live";
  if (status === "uploading" || status === "pending") return "warn";
  if (status === "failed" || status === "cancelled") return "danger";
  return "info";
}
