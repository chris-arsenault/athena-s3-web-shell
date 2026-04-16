import { useCallback, useState } from "react";

import type { AuthContext, UploadProgress } from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { uploadFile } from "../../data/s3Repo";
import type { DroppedFile } from "../../hooks/useDropzone";
import { joinPrefix } from "../../utils/parseS3Path";

interface Opts {
  provider: AuthProvider;
  context: AuthContext | null;
  prefix: string;
  onComplete: () => void;
}

export function useUploads({ provider, context, prefix, onComplete }: Opts) {
  const [items, setItems] = useState<UploadProgress[]>([]);

  const enqueue = useCallback(
    (files: DroppedFile[]) => {
      if (!context) return;
      files.forEach((df) => {
        const key = joinPrefix(prefix, df.relativePath).slice(0, -1);
        const id = `${Date.now()}-${df.relativePath}`;
        const initial: UploadProgress = {
          id,
          filename: df.relativePath,
          key,
          size: df.file.size,
          uploaded: 0,
          status: "pending",
        };
        setItems((u) => [...u, initial]);
        uploadFile(provider, context, key, df.file, initial, (p) =>
          setItems((cur) => cur.map((x) => (x.id === id ? p : x)))
        )
          .then(onComplete)
          .catch((err: Error) =>
            setItems((cur) =>
              cur.map((x) =>
                x.id === id ? { ...x, status: "failed", error: err.message } : x
              )
            )
          );
      });
    },
    [provider, context, prefix, onComplete]
  );

  const clear = useCallback(() => setItems([]), []);
  return { items, enqueue, clear };
}
