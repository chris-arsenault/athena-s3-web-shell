import { useCallback, useEffect, useState } from "react";

import type { S3Listing } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import {
  createFolder as createFolderRepo,
  deleteObject,
  downloadObject,
  listFolder,
} from "../../data/s3Repo";
import { joinPrefix } from "../../utils/parseS3Path";
import { Breadcrumb } from "./Breadcrumb";
import { FileBrowser } from "./FileBrowser";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueue } from "./UploadQueue";
import { useUploads } from "./useUploads";
import "./WorkspaceView.css";

export function WorkspaceView() {
  const { provider, context, loading } = useAuth();
  const [prefix, setPrefix] = useState<string>("");
  const [listing, setListing] = useState<S3Listing | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const uploads = useUploads({ provider, context, prefix, onComplete: refresh });

  useEffect(() => {
    if (context && !prefix) setPrefix(context.s3.prefix);
  }, [context, prefix]);

  useEffect(() => {
    if (!context || !prefix) return;
    let cancelled = false;
    listFolder(provider, context, prefix)
      .then((l) => {
        if (!cancelled) setListing(l);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, context, prefix, refreshKey]);

  const onCreateFolder = useCallback(
    async (name: string) => {
      if (!context) return;
      await createFolderRepo(provider, context, joinPrefix(prefix, name));
      refresh();
    },
    [provider, context, prefix, refresh]
  );

  const onDelete = useCallback(
    async (key: string) => {
      if (!context) return;
      await deleteObject(provider, context, key);
      refresh();
    },
    [provider, context, refresh]
  );

  const onDownload = useCallback(
    async (key: string, name: string) => {
      if (!context) return;
      const blob = await downloadObject(provider, context, key);
      saveBlobAs(blob, name);
    },
    [provider, context]
  );

  if (loading || !context) return <LoadingSpinner label="Loading workspace…" />;

  return (
    <div className="workspace flex-col flex-1">
      <Breadcrumb prefix={prefix} root={context.s3.prefix} onNavigate={setPrefix} />
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      <UploadDropzone onFiles={uploads.enqueue} onCreateFolder={onCreateFolder} />
      {uploads.items.length > 0 && (
        <UploadQueue items={uploads.items} onClear={uploads.clear} />
      )}
      <FileBrowser
        listing={listing}
        onOpen={setPrefix}
        onDelete={onDelete}
        onDownload={onDownload}
      />
    </div>
  );
}

function saveBlobAs(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
