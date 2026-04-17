import { useEffect } from "react";

import type { S3Object } from "@athena-shell/shared";

import { formatBytes } from "../../utils/formatBytes";
import { previewKind, type PreviewKind } from "../../utils/previewable";
import { ImagePreview } from "./ImagePreview";
import { JsonTreePreview } from "./JsonTreePreview";
import { ParquetPreview } from "./ParquetPreview";
import { TablePreview } from "./TablePreview";
import { TextPreview } from "./TextPreview";
import "./FilePreview.css";

interface Props {
  file: S3Object;
  onClose: () => void;
}

export function FilePreview({ file, onClose }: Props) {
  const kind = previewKind(file.name);
  useEscClose(onClose);

  return (
    <div className="fp-backdrop">
      <div
        className="fp-drawer reg"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${file.name}`}
        data-testid="fp-drawer"
      >
        <PreviewHeader file={file} kind={kind} onClose={onClose} />
        <div className="fp-body" data-testid={`fp-body-${kind}`}>
          <KindDispatch file={file} kind={kind} />
        </div>
      </div>
    </div>
  );
}

function KindDispatch({ file, kind }: { file: S3Object; kind: PreviewKind }) {
  if (kind === "image") return <ImagePreview file={file} />;
  if (kind === "csv") return <TablePreview file={file} delimiter="," />;
  if (kind === "tsv") return <TablePreview file={file} delimiter="\t" />;
  if (kind === "jsonl") return <TablePreview file={file} delimiter={null} />;
  if (kind === "json") return <JsonTreePreview file={file} />;
  if (kind === "parquet") return <ParquetPreview file={file} />;
  if (kind === "text") return <TextPreview file={file} />;
  return <ErrorPanel message={`No preview for ${file.name}`} />;
}

function PreviewHeader({
  file,
  kind,
  onClose,
}: {
  file: S3Object;
  kind: PreviewKind;
  onClose: () => void;
}) {
  return (
    <div className="fp-head">
      <div className="fp-head-tok tok tok-accent">{headerLabel(kind)}</div>
      <div className="fp-head-name mono truncate">{file.name}</div>
      <div className="fp-head-meta mono text-dim">{formatBytes(file.size)}</div>
      <button className="fp-close" onClick={onClose} aria-label="Close preview">
        [ X ]
      </button>
    </div>
  );
}

function headerLabel(kind: PreviewKind): string {
  switch (kind) {
    case "image":
      return "image";
    case "csv":
    case "tsv":
      return "table";
    case "jsonl":
      return "jsonl";
    case "json":
      return "json";
    case "parquet":
      return "parquet";
    default:
      return "preview";
  }
}

function useEscClose(onClose: () => void): void {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="fp-status fp-status-error mono">
      <span className="tok tok-danger">fault</span>
      <span className="fp-error-msg">{message}</span>
    </div>
  );
}

export function LoadingPanel() {
  return (
    <div className="fp-status mono">
      <span className="dot" aria-hidden /> fetching content…
    </div>
  );
}

interface RawToggleProps {
  raw: boolean;
  onChange: (raw: boolean) => void;
  rawLabel?: string;
  parsedLabel: string;
}

export function RawToggle({ raw, onChange, rawLabel = "raw", parsedLabel }: RawToggleProps) {
  return (
    <div className="fp-toggle" data-testid="fp-raw-toggle">
      <button
        className={`fp-toggle-btn ${!raw ? "is-active" : ""}`}
        onClick={() => onChange(false)}
      >
        {parsedLabel}
      </button>
      <button
        className={`fp-toggle-btn ${raw ? "is-active" : ""}`}
        onClick={() => onChange(true)}
      >
        {rawLabel}
      </button>
    </div>
  );
}

interface FallbackChipProps {
  message: string;
}

export function ParseErrorChip({ message }: FallbackChipProps) {
  return (
    <div className="fp-parse-err mono text-muted">
      <span className="tok tok-warn">parse</span>
      <span>{message} — showing raw</span>
    </div>
  );
}
