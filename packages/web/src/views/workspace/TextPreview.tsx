import { useEffect, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { getObjectRange, type RangeFetch } from "../../data/s3Repo";
import { formatBytes } from "../../utils/formatBytes";
import { ErrorPanel, LoadingPanel } from "./FilePreview";

interface Props {
  file: S3Object;
}

const PREVIEW_BYTES = 1_048_576;

export function TextPreview({ file }: Props) {
  const content = useTextContent(file.key);
  if (content.state === "loading") return <LoadingPanel />;
  if (content.state === "error") return <ErrorPanel message={content.error} />;
  return (
    <>
      <TextBody text={content.value.text} />
      {content.value.truncated && (
        <TruncatedFoot totalSize={content.value.totalSize} />
      )}
    </>
  );
}

export function TextBody({ text }: { text: string }) {
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

function TruncatedFoot({ totalSize }: { totalSize: number }) {
  return (
    <div className="fp-foot">
      <span className="tok tok-warn">cap</span>
      <span className="mono">
        showing first {formatBytes(PREVIEW_BYTES)} of {formatBytes(totalSize)} ·
        download for the full file
      </span>
    </div>
  );
}

type ContentState =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; value: RangeFetch };

export function useTextContent(key: string, bytes: number = PREVIEW_BYTES): ContentState {
  const { provider, context } = useAuth();
  const [state, setState] = useState<ContentState>({ state: "loading" });
  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setState({ state: "loading" });
    getObjectRange(provider, context, key, bytes)
      .then((v) => {
        if (!cancelled) setState({ state: "ready", value: v });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ state: "error", error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, key, bytes]);
  return state;
}
