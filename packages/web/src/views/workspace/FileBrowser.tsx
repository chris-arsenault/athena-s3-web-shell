import type { S3Listing } from "@athena-shell/shared";

import { EmptyState } from "../../components/EmptyState";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { fileTypeIcon } from "../../utils/fileTypeIcon";
import { formatBytes } from "../../utils/formatBytes";
import { formatDate } from "../../utils/formatDate";
import "./FileBrowser.css";

interface Props {
  listing: S3Listing | null;
  onOpen: (prefix: string) => void;
  onDelete: (key: string) => void | Promise<void>;
  onDownload: (key: string, name: string) => void | Promise<void>;
}

export function FileBrowser({ listing, onOpen, onDelete, onDownload }: Props) {
  if (!listing) return <LoadingSpinner label="Loading…" />;
  const isEmpty = listing.folders.length === 0 && listing.objects.length === 0;
  if (isEmpty) {
    return (
      <EmptyState
        icon="📁"
        title="This folder is empty"
        hint="Drop files here to upload."
      />
    );
  }
  return (
    <div className="file-browser">
      <div className="fb-row fb-head text-muted text-sm">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
        <span />
      </div>
      {listing.folders.map((f) => (
        <button key={f.key} className="fb-row fb-clickable" onClick={() => onOpen(f.key)}>
          <span className="flex-row gap-2">
            <span>📁</span>
            <span className="truncate">{f.name}/</span>
          </span>
          <span className="text-muted text-sm">—</span>
          <span className="text-muted text-sm">—</span>
          <span />
        </button>
      ))}
      {listing.objects.map((o) => (
        <div key={o.key} className="fb-row">
          <span className="flex-row gap-2 truncate">
            <span>{fileTypeIcon(o.name)}</span>
            <span className="truncate">{o.name}</span>
          </span>
          <span className="text-muted text-sm">{formatBytes(o.size)}</span>
          <span className="text-muted text-sm">{formatDate(o.lastModified)}</span>
          <span className="flex-row gap-1">
            <button className="btn btn-ghost" onClick={() => onDownload(o.key, o.name)}>
              Download
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (confirm(`Delete ${o.name}?`)) onDelete(o.key);
              }}
            >
              Delete
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
