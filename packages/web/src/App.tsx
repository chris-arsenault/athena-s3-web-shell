import { Outlet } from "react-router-dom";

import { AuthProviderProvider } from "./auth/authContext";
import { MockAuthProvider } from "./auth/MockAuthProvider";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

const provider = new MockAuthProvider();

export function App() {
  return (
    <AuthProviderProvider provider={provider}>
      <ErrorBoundary>
        <AppShell>
          <Outlet />
        </AppShell>
      </ErrorBoundary>
    </AuthProviderProvider>
  );
}
