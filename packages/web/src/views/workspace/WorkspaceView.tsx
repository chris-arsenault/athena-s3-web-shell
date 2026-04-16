import { useCallback, useEffect, useState } from "react";

import type { DatasetFileType, S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { tableFileTypeFor } from "../../data/datasetsRepo";
import {
  createFolder as createFolderRepo,
  deleteObject,
  downloadObject,
} from "../../data/s3Repo";
import { joinPrefix } from "../../utils/parseS3Path";
import { Breadcrumb } from "./Breadcrumb";
import { CreateTableModal } from "./CreateTableModal";
import { FileBrowser } from "./FileBrowser";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueue } from "./UploadQueue";
import { useFileListing } from "./useFileListing";
import { useUploads } from "./useUploads";
import "./WorkspaceView.css";

interface RegisterTarget {
  file: S3Object;
  fileType: DatasetFileType;
}

export function WorkspaceView() {
  const { provider, context, loading } = useAuth();
  const [prefix, setPrefix] = useState<string>("");
  const { listing, error, setError, refresh } = useFileListing(provider, context, prefix);
  const [registering, setRegistering] = useState<RegisterTarget | null>(null);
  const uploads = useUploads({ provider, context, prefix, onComplete: refresh });

  useEffect(() => {
    if (context && !prefix) setPrefix(context.s3.prefix);
  }, [context, prefix]);

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

  const onRegisterTable = useCallback((obj: S3Object) => {
    const fileType = tableFileTypeFor(obj.name);
    if (fileType) setRegistering({ file: obj, fileType });
  }, []);

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
        onRegisterTable={onRegisterTable}
      />
      {registering && (
        <CreateTableModal
          file={registering.file}
          fileType={registering.fileType}
          onClose={() => setRegistering(null)}
          onCreated={() => {
            setRegistering(null);
            refresh();
          }}
        />
      )}
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
