import { Outlet } from "react-router-dom";
import type { ReactNode } from "react";

import { AuthProviderProvider, useAuth } from "./auth/authContext";
import { provider } from "./auth/provider";
import { AppShell } from "./components/AppShell";
import { AuthSplash } from "./components/AuthSplash";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { SchemaProvider } from "./data/schemaContext";

export function App() {
  return (
    <AuthProviderProvider provider={provider}>
      <ErrorBoundary>
        <AuthGate>
          <SchemaProvider>
            <AppShell>
              <Outlet />
            </AppShell>
          </SchemaProvider>
        </AuthGate>
      </ErrorBoundary>
    </AuthProviderProvider>
  );
}

/**
 * Withhold rendering the full console until the auth context has resolved.
 * In cognito mode this prevents the SPA from flashing the AppShell chrome
 * for the few ms between mount and the Hosted UI redirect.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const { context, loading, error } = useAuth();
  if (loading || !context) return <AuthSplash error={error} />;
  return <>{children}</>;
}
