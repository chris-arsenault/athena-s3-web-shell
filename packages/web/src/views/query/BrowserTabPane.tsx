import { useCallback, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import type { DatasetFileType, S3Object } from "@athena-shell/shared";

import { useAuth } from "../../auth/authContext";
import { ErrorBanner } from "../../components/ErrorBanner";
import { tableFileTypeFor } from "../../data/datasetsRepo";
import {
  createFolder as createFolderRepo,
  deleteObject,
  downloadObject,
} from "../../data/s3Repo";
import { joinPrefix } from "../../utils/parseS3Path";
import { Breadcrumb } from "../workspace/Breadcrumb";
import { CreateTableModal } from "../workspace/CreateTableModal";
import { FileBrowser } from "../workspace/FileBrowser";
import { FilePreview } from "../workspace/FilePreview";
import { UploadDropzone } from "../workspace/UploadDropzone";
import { UploadQueue } from "../workspace/UploadQueue";
import { useFileListing } from "../workspace/useFileListing";
import { useUploads } from "../workspace/useUploads";
import type { Tab } from "./useTabs";
import "./BrowserTabPane.css";

interface Props {
  tab: Tab;
  hidden: boolean;
  onPatch: (patch: Partial<Tab>) => void;
}

interface RegisterTarget {
  file: S3Object;
  fileType: DatasetFileType;
}

/**
 * File-browser tab. Mirrors the SQL TabPane shape: a vertical split
 * with the "work surface" (file listing) on top and the "sink"
 * (upload dropzone + queue) on bottom. Preview drawer + CreateTable
 * modal are overlays, same as on the former WorkspaceView.
 */
export function BrowserTabPane({ tab, hidden, onPatch }: Props) {
  const { provider, context } = useAuth();
  const prefix = tab.prefix ?? context?.s3.prefix ?? "";
  const setPrefix = useCallback(
    (next: string) => {
      onPatch({ prefix: next, name: prefixDisplayName(next, context?.s3.prefix) });
    },
    [onPatch, context?.s3.prefix]
  );
  const { listing, error, setError, refresh } = useFileListing(provider, context, prefix);
  const uploads = useUploads({ provider, context, prefix, onComplete: refresh });
  const [registering, setRegistering] = useState<RegisterTarget | null>(null);
  const [previewing, setPreviewing] = useState<S3Object | null>(null);
  const actions = useBrowserActions({ provider, context, prefix, refresh, setRegistering });

  if (!context) return null;

  return (
    <div
      className={`query-main flex-col flex-1 ${hidden ? "is-hidden" : ""}`}
      data-testid={`tabpane-${tab.id}`}
      aria-hidden={hidden}
    >
      <PanelGroup direction="vertical" autoSaveId="athena-shell.browser-tabpane" className="browser-split">
        <Panel id="browser-top" order={1} defaultSize={65} minSize={25} className="browser-top-panel">
          <div className="browser-work">
            <Breadcrumb prefix={prefix} root={context.s3.prefix} onNavigate={setPrefix} />
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
            <FileBrowser
              listing={listing}
              onOpen={setPrefix}
              onDelete={actions.onDelete}
              onDownload={actions.onDownload}
              onRegisterTable={actions.onRegisterTable}
              onPreview={setPreviewing}
            />
          </div>
        </Panel>
        <PanelResizeHandle />
        <Panel id="browser-bottom" order={2} defaultSize={35} minSize={15} className="browser-bottom-panel">
          <div className="browser-sink">
            <UploadDropzone onFiles={uploads.enqueue} onCreateFolder={actions.onCreateFolder} />
            {uploads.items.length > 0 && <UploadQueue items={uploads.items} onClear={uploads.clear} />}
          </div>
        </Panel>
      </PanelGroup>
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

interface BrowserActionsArgs {
  provider: ReturnType<typeof useAuth>["provider"];
  context: ReturnType<typeof useAuth>["context"];
  prefix: string;
  refresh: () => void;
  setRegistering: (t: RegisterTarget | null) => void;
}

function useBrowserActions(args: BrowserActionsArgs) {
  const { provider, context, prefix, refresh, setRegistering } = args;
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
  const onRegisterTable = useCallback(
    (obj: S3Object) => {
      const fileType = tableFileTypeFor(obj.name);
      if (fileType) setRegistering({ file: obj, fileType });
    },
    [setRegistering]
  );
  return { onCreateFolder, onDelete, onDownload, onRegisterTable };
}

function saveBlobAs(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function prefixDisplayName(prefix: string, root?: string): string {
  const trimmed = prefix.replace(/\/$/, "");
  if (!trimmed || (root && trimmed === root.replace(/\/$/, ""))) return "/";
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last || "/";
}
