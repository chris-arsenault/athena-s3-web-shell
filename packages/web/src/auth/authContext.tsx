import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { AuthContext as AuthCtx } from "@athena-shell/shared";

import type { AuthProvider } from "./AuthProvider";

interface AuthValue {
  provider: AuthProvider;
  context: AuthCtx | null;
  loading: boolean;
  error: Error | null;
}

const Ctx = createContext<AuthValue | null>(null);

interface AuthProviderProps {
  provider: AuthProvider;
  children: ReactNode;
}

export function AuthProviderProvider({ provider, children }: AuthProviderProps) {
  const [context, setContext] = useState<AuthCtx | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    provider
      .getContext()
      .then((c) => {
        if (!cancelled) setContext(c);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  return <Ctx.Provider value={{ provider, context, loading, error }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProviderProvider");
  return v;
}
