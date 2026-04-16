import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../auth/authContext";
import { useDropzone, type DroppedFile } from "../../hooks/useDropzone";
import { classNames } from "../../utils/classNames";
import "./UploadDropzone.css";

interface Props {
  onFiles: (files: DroppedFile[]) => void;
  onCreateFolder: (name: string) => Promise<void>;
}

export function UploadDropzone({ onFiles, onCreateFolder }: Props) {
  const { context } = useAuth();
  const { active, dropzoneProps } = useDropzone(onFiles);
  return (
    <div {...dropzoneProps} className={classNames("drop", { "drop-active": active })}>
      <div className="drop-sweep" aria-hidden />
      <div className="drop-core flex-row">
        <DropBanner
          bucket={context?.s3.bucket ?? "—"}
          prefix={context?.s3.prefix ?? "—"}
        />
        <DropActions onFiles={onFiles} onCreateFolder={onCreateFolder} />
      </div>
    </div>
  );
}

function DropBanner({ bucket, prefix }: { bucket: string; prefix: string }) {
  return (
    <div className="drop-msg flex-col gap-1">
      <div className="drop-head flex-row gap-2">
        <span className="tok tok-accent">ingress</span>
        <span className="tracked drop-head-label">drop · paste · select</span>
      </div>
      <div className="drop-title">
        <span className="serif">Deposit files</span>
        <span className="drop-arrow" aria-hidden>→</span>
      </div>
      <div className="drop-target mono">
        <span className="text-dim">s3://</span>
        <span className="drop-bucket">{bucket}</span>
        <span className="text-dim">/</span>
        <span className="drop-prefix truncate">{prefix}</span>
      </div>
    </div>
  );
}

interface DropActionsProps {
  onFiles: (files: DroppedFile[]) => void;
  onCreateFolder: (name: string) => Promise<void>;
}

function DropActions({ onFiles, onCreateFolder }: DropActionsProps) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="drop-actions flex-row gap-2 ml-auto">
      <label className="btn btn-secondary cursor-pointer">
        <span>select files</span>
        <input
          type="file"
          multiple
          className="visually-hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).map((f) => ({
              file: f,
              relativePath: f.name,
            }));
            if (files.length > 0) onFiles(files);
            e.target.value = "";
          }}
        />
      </label>
      {creating ? (
        <NewFolderForm
          onSubmit={onCreateFolder}
          onClose={() => setCreating(false)}
        />
      ) : (
        <button className="btn" onClick={() => setCreating(true)}>
          <span aria-hidden>+</span>
          <span>new folder</span>
        </button>
      )}
    </div>
  );
}

interface NewFolderFormProps {
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

function NewFolderForm({ onSubmit, onClose }: NewFolderFormProps) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <form
      className="flex-row gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed).finally(onClose);
      }}
    >
      <input
        ref={inputRef}
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="folder name"
      />
      <button className="btn btn-primary" type="submit">create</button>
      <button className="btn btn-ghost" type="button" onClick={onClose}>cancel</button>
    </form>
  );
}
