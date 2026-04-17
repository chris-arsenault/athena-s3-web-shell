import { useEffect, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { getObjectBlob } from "../../data/s3Repo";
import { formatBytes } from "../../utils/formatBytes";
import { ErrorPanel, LoadingPanel } from "./FilePreview";

interface Props {
  file: S3Object;
}

const IMAGE_CAP_BYTES = 25 * 1024 * 1024;

export function ImagePreview({ file }: Props) {
  const { provider, context } = useAuth();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    if (file.size > IMAGE_CAP_BYTES) return;
    let cancelled = false;
    let created: string | null = null;
    getObjectBlob(provider, context, file.key)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [provider, context, file.key, file.size]);

  if (file.size > IMAGE_CAP_BYTES) {
    return (
      <div className="fp-status mono" data-testid="fp-image-too-large">
        <span className="tok tok-warn">cap</span>
        <span>
          image is {formatBytes(file.size)} (cap {formatBytes(IMAGE_CAP_BYTES)}) ·
          download to view
        </span>
      </div>
    );
  }
  if (error) return <ErrorPanel message={error} />;
  if (!url) return <LoadingPanel />;
  return (
    <div className="fp-image-wrap">
      {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
      <img
        src={url}
        alt={`Preview of ${file.name}`}
        className="fp-image"
        data-testid="fp-image"
      />
    </div>
  );
}
