import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { DatasetFileType, S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { tableFileTypeFor } from "../../data/datasetsRepo";
import { session } from "../../data/localDb";
import {
  createFolder as createFolderRepo,
  deleteObject,
  downloadObject,
} from "../../data/s3Repo";
import { joinPrefix } from "../../utils/parseS3Path";
import { Breadcrumb } from "./Breadcrumb";
import { CreateTableModal } from "./CreateTableModal";
import { FileBrowser } from "./FileBrowser";
import { FilePreview } from "./FilePreview";
import { UploadDropzone } from "./UploadDropzone";
import { UploadQueue } from "./UploadQueue";
import { useFileListing } from "./useFileListing";
import { useUploads } from "./useUploads";
import "./WorkspaceView.css";

const WORKSPACE_PREFIX_KEY = "workspacePrefix";

function useUrlPrefixOverride(
  params: URLSearchParams,
  root: string | undefined,
  setPrefix: (p: string) => void
): void {
  // Reading once per params change is fine — SchemaTree → Workspace
  // crosslinks navigate by updating the URL, which bumps params.
  useEffect(() => {
    if (!root) return;
    const urlPrefix = params.get("prefix");
    if (urlPrefix && urlPrefix.startsWith(root)) {
      setPrefix(urlPrefix);
    }
  }, [params, root, setPrefix]);
}

function usePersistedPrefix(
  root: string | undefined,
  prefix: string,
  setPrefix: (p: string) => void
): void {
  useEffect(() => {
    if (!root || prefix) return;
    let cancelled = false;
    void (async () => {
      const stored = await session.get(WORKSPACE_PREFIX_KEY);
      if (cancelled) return;
      const candidate = stored && stored.startsWith(root) ? stored : root;
      setPrefix(candidate);
    })();
    return () => {
      cancelled = true;
    };
  }, [root, prefix, setPrefix]);

  useEffect(() => {
    if (prefix) void session.set(WORKSPACE_PREFIX_KEY, prefix);
  }, [prefix]);
}

interface RegisterTarget {
  file: S3Object;
  fileType: DatasetFileType;
}

export function WorkspaceView() {
  const { provider, context, loading } = useAuth();
  const [prefix, setPrefix] = useState<string>("");
  const [params] = useSearchParams();
  const { listing, error, setError, refresh } = useFileListing(provider, context, prefix);
  const [registering, setRegistering] = useState<RegisterTarget | null>(null);
  const [previewing, setPreviewing] = useState<S3Object | null>(null);
  const uploads = useUploads({ provider, context, prefix, onComplete: refresh });

  usePersistedPrefix(context?.s3.prefix, prefix, setPrefix);
  useUrlPrefixOverride(params, context?.s3.prefix, setPrefix);

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
        onPreview={setPreviewing}
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
      {previewing && <FilePreview file={previewing} onClose={() => setPreviewing(null)} />}
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
