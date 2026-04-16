import { useCallback, useEffect, useState } from "react";

import type { AuthContext, S3Listing } from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { listFolder } from "../../data/s3Repo";

export interface FileListing {
  listing: S3Listing | null;
  error: Error | null;
  setError: (e: Error | null) => void;
  refresh: () => void;
}

export function useFileListing(
  provider: AuthProvider,
  context: AuthContext | null,
  prefix: string
): FileListing {
  const [listing, setListing] = useState<S3Listing | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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

  return { listing, error, setError, refresh };
}
