import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "../auth/authContext";
import "./AppShell.css";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { context, loading } = useAuth();
  return (
    <div className="app-shell">
      <header className="app-header flex-row gap-3">
        <span className="app-title">athena-shell</span>
        <span className="text-muted text-sm">
          {loading ? "…" : context?.s3.bucket}/{context?.s3.prefix}
        </span>
        <span className="ml-auto text-muted text-sm">
          {context?.displayName} · {context?.athena.workgroup}
        </span>
      </header>
      <div className="app-body flex-row flex-1">
        <nav className="app-nav flex-col gap-1">
          <NavLink to="/workspace" className="app-nav-link">
            <span>📂</span>
            <span>Workspace</span>
          </NavLink>
          <NavLink to="/query" className="app-nav-link">
            <span>⌘</span>
            <span>Query</span>
          </NavLink>
        </nav>
        <main className="app-main flex-1">{children}</main>
      </div>
    </div>
  );
}
