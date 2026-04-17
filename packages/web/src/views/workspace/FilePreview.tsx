import { useEffect, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { getObjectRange, type RangeFetch } from "../../data/s3Repo";
import { formatBytes } from "../../utils/formatBytes";
import "./FilePreview.css";

const PREVIEW_BYTES = 1_048_576;

interface Props {
  file: S3Object;
  onClose: () => void;
}

export function FilePreview({ file, onClose }: Props) {
  const { provider, context } = useAuth();
  const [content, setContent] = useState<RangeFetch | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    getObjectRange(provider, context, file.key, PREVIEW_BYTES)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, file.key]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <div className="fp-backdrop">
      <div
        className="fp-drawer reg"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${file.name}`}
        data-testid="fp-drawer"
      >
        <PreviewHeader file={file} onClose={onClose} truncated={!!content?.truncated} />
        <div className="fp-body">
          {error && <ErrorPanel message={error.message} />}
          {!error && !content && <LoadingPanel />}
          {!error && content && <PreviewBody text={content.text} />}
        </div>
        {content?.truncated && (
          <div className="fp-foot">
            <span className="tok tok-warn">cap</span>
            <span className="mono">
              showing first {formatBytes(PREVIEW_BYTES)} of{" "}
              {formatBytes(content.totalSize)} · download for the full file
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface HeaderProps {
  file: S3Object;
  onClose: () => void;
  truncated: boolean;
}

function PreviewHeader({ file, onClose, truncated }: HeaderProps) {
  return (
    <div className="fp-head">
      <div className="fp-head-tok tok tok-accent">preview</div>
      <div className="fp-head-name mono truncate">{file.name}</div>
      <div className="fp-head-meta mono text-dim">
        {formatBytes(file.size)}
        {truncated && " · partial"}
      </div>
      <button className="fp-close" onClick={onClose} aria-label="Close preview">
        [ X ]
      </button>
    </div>
  );
}

function PreviewBody({ text }: { text: string }) {
  const lines = text.length === 0 ? [""] : text.split("\n");
  return (
    <div className="fp-pre" role="document">
      {lines.map((line, i) => (
        <div key={i} className="fp-line">
          <span className="fp-lineno mono tnum">{i + 1}</span>
          <span className="fp-linetext mono">{line.length === 0 ? " " : line}</span>
        </div>
      ))}
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="fp-status mono">
      <span className="dot" aria-hidden /> fetching content…
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="fp-status fp-status-error mono">
      <span className="tok tok-danger">fault</span>
      <span className="fp-error-msg">{message}</span>
    </div>
  );
}
