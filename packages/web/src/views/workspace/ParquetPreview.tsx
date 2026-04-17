import { useEffect, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { formatBytes } from "../../utils/formatBytes";
import { ErrorPanel, LoadingPanel } from "./FilePreview";
import { loadParquetMeta, type ParquetMeta } from "./parquetMeta";

interface Props {
  file: S3Object;
}

export function ParquetPreview({ file }: Props) {
  const { provider, context } = useAuth();
  const [meta, setMeta] = useState<ParquetMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!context) return;
    let cancelled = false;
    setMeta(null);
    setError(null);
    loadParquetMeta(provider, context, file.key)
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, file.key]);

  if (error) return <ErrorPanel message={error} />;
  if (!meta) return <LoadingPanel />;

  return (
    <div className="fp-parquet" data-testid="fp-parquet">
      <ParquetStats meta={meta} fileSize={file.size} />
      <ParquetSchema columns={meta.columns} />
      {meta.createdBy && (
        <div className="fp-parquet-createdby mono text-muted">
          created by <span className="text-dim">{meta.createdBy}</span>
        </div>
      )}
    </div>
  );
}

function ParquetStats({ meta, fileSize }: { meta: ParquetMeta; fileSize: number }) {
  return (
    <div className="fp-parquet-stats">
      <Stat label="rows" value={meta.numRows.toLocaleString()} />
      <Stat label="row groups" value={String(meta.numRowGroups)} />
      <Stat label="columns" value={String(meta.columns.length)} />
      <Stat label="file size" value={formatBytes(fileSize)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fp-parquet-stat">
      <div className="fp-parquet-value serif tnum">{value}</div>
      <div className="fp-parquet-label tracked">{label}</div>
    </div>
  );
}

function ParquetSchema({ columns }: { columns: ParquetMeta["columns"] }) {
  return (
    <div className="fp-parquet-schema">
      <div className="tracked fp-parquet-schema-head">schema</div>
      <ul className="fp-parquet-cols">
        {columns.map((c, i) => (
          <li key={`${c.name}-${i}`} className="fp-parquet-col">
            <span className="mono text-dim fp-parquet-idx">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="mono fp-parquet-col-name">{c.name}</span>
            <span className="mono fp-parquet-col-type">{c.type.toLowerCase()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
