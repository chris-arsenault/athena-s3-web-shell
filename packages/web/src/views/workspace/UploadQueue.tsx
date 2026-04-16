import type { UploadProgress } from "@athena-shell/shared";

import { formatBytes } from "../../utils/formatBytes";
import "./UploadQueue.css";

interface Props {
  items: UploadProgress[];
  onClear: () => void;
}

export function UploadQueue({ items, onClear }: Props) {
  const allDone = items.every((i) => i.status === "succeeded" || i.status === "failed");
  return (
    <div className="upload-queue">
      <div className="flex-row gap-2">
        <strong>Uploads</strong>
        <span className="text-muted text-sm">({items.length})</span>
        {allDone && (
          <button className="btn btn-ghost ml-auto" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <ul className="upload-list">
        {items.map((item) => {
          const pct = item.size === 0 ? 100 : Math.round((item.uploaded / item.size) * 100);
          return (
            <li key={item.id} className="upload-row flex-col gap-1">
              <div className="flex-row gap-2">
                <span className="truncate flex-1">{item.filename}</span>
                <span className="text-muted text-sm">{formatBytes(item.size)}</span>
                <span className={`upload-status status-${item.status}`}>{item.status}</span>
              </div>
              <div className="upload-bar">
                {/* eslint-disable-next-line local/no-inline-styles */}
                <span className="upload-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              {item.error && <span className="text-sm upload-error">{item.error}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
