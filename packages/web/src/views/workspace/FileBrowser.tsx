import type { S3Folder, S3Listing, S3Object } from "@athena-shell/shared";

import { EmptyState } from "../../components/EmptyState";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { tableFileTypeFor } from "../../data/datasetsRepo";
import { fileTypeIcon } from "../../utils/fileTypeIcon";
import { formatBytes } from "../../utils/formatBytes";
import { formatDate } from "../../utils/formatDate";
import { isPreviewable } from "../../utils/previewable";
import "./FileBrowser.css";

interface Props {
  listing: S3Listing | null;
  onOpen: (prefix: string) => void;
  onDelete: (key: string) => void | Promise<void>;
  onDownload: (key: string, name: string) => void | Promise<void>;
  onRegisterTable: (obj: S3Object) => void;
  onPreview: (obj: S3Object) => void;
}

export function FileBrowser({
  listing,
  onOpen,
  onDelete,
  onDownload,
  onRegisterTable,
  onPreview,
}: Props) {
  if (!listing) return <LoadingSpinner label="listing" />;
  const total = listing.folders.length + listing.objects.length;
  if (total === 0) {
    return (
      <EmptyState
        icon="∅"
        title="This prefix is empty."
        hint="Drop files onto the zone above, or create a sub-folder to organize."
      />
    );
  }
  return (
    <div className="fb">
      <Banner
        total={total}
        folders={listing.folders.length}
        files={listing.objects.length}
      />
      <div className="fb-grid">
        <HeadRow />
        {listing.folders.map((f) => (
          <FolderRow key={f.key} folder={f} onOpen={onOpen} />
        ))}
        {listing.objects.map((o) => (
          <FileRow
            key={o.key}
            obj={o}
            onDownload={onDownload}
            onDelete={onDelete}
            onRegisterTable={onRegisterTable}
            onPreview={onPreview}
          />
        ))}
      </div>
    </div>
  );
}

function Banner({ total, folders, files }: { total: number; folders: number; files: number }) {
  return (
    <div className="fb-banner flex-row gap-3">
      <span className="tracked">Objects</span>
      <span className="tok">{String(total).padStart(3, "0")} · items</span>
      <span className="fb-banner-rule" aria-hidden />
      <span className="tracked text-dim">
        <span className="mono">{folders}</span> folders
        <span className="fb-banner-dot" aria-hidden>·</span>
        <span className="mono">{files}</span> files
      </span>
    </div>
  );
}

function HeadRow() {
  return (
    <div className="fb-row fb-head">
      <span className="tracked">name</span>
      <span className="tracked text-right">size</span>
      <span className="tracked">modified</span>
      <span />
    </div>
  );
}

function FolderRow({ folder, onOpen }: { folder: S3Folder; onOpen: (p: string) => void }) {
  return (
    <button className="fb-row fb-clickable fb-folder" onClick={() => onOpen(folder.key)}>
      <span className="fb-name">
        <span className="ftype ftype-dir" aria-hidden>▤</span>
        <span className="truncate fb-name-text">{folder.name}/</span>
      </span>
      <span className="text-dim mono text-right">—</span>
      <span className="text-dim mono">—</span>
      <span className="fb-actions fb-actions-folder">
        <span className="fb-open-hint tracked">open →</span>
      </span>
    </button>
  );
}

interface FileRowProps {
  obj: S3Object;
  onDownload: (key: string, name: string) => void | Promise<void>;
  onDelete: (key: string) => void | Promise<void>;
  onRegisterTable: (obj: S3Object) => void;
  onPreview: (obj: S3Object) => void;
}

function FileRow({
  obj,
  onDownload,
  onDelete,
  onRegisterTable,
  onPreview,
}: FileRowProps) {
  const type = fileTypeIcon(obj.name);
  const canRegister = tableFileTypeFor(obj.name) !== null;
  const canPreview = isPreviewable(obj.name);
  return (
    <div className="fb-row fb-file">
      <span className="fb-name">
        <span className={`ftype ftype-${type.kind}`} aria-hidden>{type.code}</span>
        {canPreview ? (
          <button
            className="truncate fb-name-text fb-name-link"
            onClick={() => onPreview(obj)}
            title="Preview"
          >
            {obj.name}
          </button>
        ) : (
          <span className="truncate fb-name-text">{obj.name}</span>
        )}
      </span>
      <span className="mono text-right tnum fb-size">{formatBytes(obj.size)}</span>
      <span className="mono tnum text-muted fb-date">{formatDate(obj.lastModified)}</span>
      <span className="fb-actions flex-row gap-1">
        {canRegister && (
          <button
            className="btn btn-ghost fb-action"
            onClick={() => onRegisterTable(obj)}
          >
            ⊞ table
          </button>
        )}
        <button className="btn btn-ghost fb-action" onClick={() => onDownload(obj.key, obj.name)}>
          ↓ get
        </button>
        <button
          className="btn btn-ghost fb-action fb-action-danger"
          onClick={() => {
            if (confirm(`Delete ${obj.name}?`)) onDelete(obj.key);
          }}
        >
          ✕ del
        </button>
      </span>
    </div>
  );
}
