import { useEffect, useRef, useState } from "react";

import { useDropzone, type DroppedFile } from "../../hooks/useDropzone";
import { classNames } from "../../utils/classNames";
import "./UploadDropzone.css";

interface Props {
  onFiles: (files: DroppedFile[]) => void;
  onCreateFolder: (name: string) => Promise<void>;
}

export function UploadDropzone({ onFiles, onCreateFolder }: Props) {
  const { active, dropzoneProps } = useDropzone(onFiles);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  return (
    <div
      {...dropzoneProps}
      className={classNames("dropzone", { "dropzone-active": active })}
    >
      <div className="dropzone-msg flex-col gap-1">
        <span className="dropzone-icon">📥</span>
        <span>Drop files or folders here to upload</span>
        <span className="text-muted text-sm">
          Files upload directly to your personal S3 prefix.
        </span>
      </div>
      <div className="dropzone-actions flex-row gap-2 ml-auto">
        <label className="btn btn-secondary cursor-pointer">
          Choose files
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
          <form
            className="flex-row gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!folderName.trim()) return;
              onCreateFolder(folderName.trim()).finally(() => {
                setCreating(false);
                setFolderName("");
              });
            }}
          >
            <input
              ref={inputRef}
              className="input"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="folder name"
            />
            <button className="btn" type="submit">
              Create
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="btn btn-secondary" onClick={() => setCreating(true)}>
            New folder
          </button>
        )}
      </div>
    </div>
  );
}
