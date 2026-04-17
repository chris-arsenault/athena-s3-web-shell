import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import type { AuthContext as AuthCtx } from "@athena-shell/shared";

import { useAuth } from "../auth/authContext";
import { useTabsContext } from "../views/query/tabsContext";
import "./AppShell.css";

interface AppShellProps {
  children: ReactNode;
}

interface NavSpec {
  kind: "browser" | "sql";
  index: string;
  label: string;
  hint: string;
  glyph: "workspace" | "query";
}

const NAV_ITEMS: NavSpec[] = [
  { kind: "browser", index: "01", label: "WORKSPACE", hint: "FILES · S3", glyph: "workspace" },
  { kind: "sql", index: "02", label: "QUERY", hint: "SQL · ATHENA", glyph: "query" },
];

export function AppShell({ children }: AppShellProps) {
  const { context, loading, provider } = useAuth();
  const mock = provider.isMock();
  return (
    <div className="console">
      <Header />
      <div className="console-body flex-row">
        <ConsoleNav />
        <main className="console-main flex-1">{children}</main>
      </div>
      <StatusBar {...statusBarProps(context, loading, mock)} />
    </div>
  );
}

function ConsoleNav() {
  return (
    <nav className="console-nav flex-col" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.kind} {...item} />
      ))}
      <NavFoot />
    </nav>
  );
}

function NavItem({ kind, index, label, hint, glyph }: NavSpec) {
  const { context } = useAuth();
  const tabsApi = useTabsContext();
  const navigate = useNavigate();
  const testId = `nav-link-${kind === "browser" ? "workspace" : "query"}`;
  const isActive = (tabsApi.activeTab?.kind ?? "sql") === kind;

  const onClick = () => {
    // Dispatch the tab change, then mirror it in the URL so bookmarks
    // and deep-links reflect the active surface.
    if (kind === "browser") {
      const existing = tabsApi.tabs.find((t) => t.kind === "browser");
      if (existing) tabsApi.setActive(existing.id);
      else if (context) tabsApi.openBrowserTab(context.s3.prefix);
      navigate("/workspace");
    } else {
      const existing = tabsApi.tabs.find((t) => (t.kind ?? "sql") === "sql");
      if (existing) tabsApi.setActive(existing.id);
      else tabsApi.newTab();
      navigate("/query");
    }
  };

  return (
    <button
      type="button"
      className={`console-nav-link ${isActive ? "active" : ""}`}
      data-testid={testId}
      title={`${label} — ${hint}`}
      onClick={onClick}
    >
      <span className="nav-mark" aria-hidden data-active={isActive} />
      <span className="nav-index">{index}</span>
      <span className="nav-glyph" aria-hidden>
        <NavGlyph kind={glyph} />
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
}

function NavFoot() {
  return (
    <div className="console-nav-foot" aria-hidden>
      <div className="nav-foot-chip" title="Target: VPC · PRIVATE">
        <span className="nav-foot-key">TGT</span>
        <span className="nav-foot-val">VPC</span>
      </div>
      <div className="nav-foot-chip" title="Egress: NONE">
        <span className="nav-foot-key">EGR</span>
        <span className="nav-foot-val">×</span>
      </div>
      <div className="nav-foot-chip" title="Build: v1.0.0">
        <span className="nav-foot-key">BLD</span>
        <span className="nav-foot-val">1.0</span>
      </div>
    </div>
  );
}

function NavGlyph({ kind }: { kind: "workspace" | "query" }) {
  if (kind === "workspace") {
    return (
      <svg viewBox="0 0 20 20" width="18" height="18">
        {/* A tray / stacked objects — S3 buckets as sideways prisms */}
        <rect x="2" y="5" width="16" height="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2" y="9.5" width="16" height="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <rect x="2" y="14" width="16" height="3" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5" cy="6.5" r="0.6" fill="currentColor" />
        <circle cx="5" cy="11" r="0.6" fill="currentColor" />
        <circle cx="5" cy="15.5" r="0.6" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" width="18" height="18">
      {/* SQL prompt: chevron + cursor */}
      <path
        d="M4 6 L8 10 L4 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <rect x="10" y="13" width="7" height="1.2" fill="currentColor" />
      <rect x="2.5" y="17" width="15" height="0.8" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

function Header() {
  const { context } = useAuth();
  const name = context?.displayName ?? "…";
  const role = lastRoleSegment(context?.roleArn);
  const initials = computeInitials(context?.displayName);
  return (
    <header className="console-head flex-row">
      <div className="brand flex-row gap-3">
        <div className="brand-mark" aria-hidden>
          <BrandGlyph />
        </div>
        <div className="flex-col">
          <div className="brand-word">
            athena<span className="brand-sep">·</span>
            <span className="brand-sub">shell</span>
          </div>
          <div className="brand-tag tracked">
            operator console <span className="brand-v">v1</span>
          </div>
        </div>
      </div>
      <div className="head-center flex-row gap-3">
        <span className="tok tok-live">
          <span className="dot" aria-hidden /> session active
        </span>
      </div>
      <div className="principal flex-row gap-3 ml-auto">
        <div className="flex-col principal-info">
          <div className="principal-name">{name}</div>
          <div className="principal-role tnum">{role}</div>
        </div>
        <div className="principal-stamp" aria-hidden>{initials}</div>
      </div>
    </header>
  );
}

interface StatusBarProps {
  loading: boolean;
  mock: boolean;
  bucket: string;
  prefix: string;
  workgroup: string;
  region: string;
  user: string;
}

const DASH = "—";

function statusBarProps(
  ctx: AuthCtx | null,
  loading: boolean,
  mock: boolean
): StatusBarProps {
  if (!ctx) {
    return { loading, mock, bucket: DASH, prefix: DASH, workgroup: DASH, region: DASH, user: DASH };
  }
  return {
    loading,
    mock,
    bucket: ctx.s3.bucket,
    prefix: ctx.s3.prefix,
    workgroup: ctx.athena.workgroup,
    region: ctx.region,
    user: ctx.displayName,
  };
}

function StatusBar({ loading, mock, bucket, prefix, workgroup, region }: StatusBarProps) {
  const clock = useClock();
  const linkLabel = loading ? "LINK · NEGOTIATING" : "LINK · OK";
  return (
    <footer className="statusbar flex-row gap-3" role="status" aria-live="polite">
      <span className="flex-row gap-2">
        <span className={`dot ${loading ? "dot-warn" : ""}`} aria-hidden />
        <span className="sb-key">{linkLabel}</span>
      </span>
      <Sep />
      <Pair k="BKT" v={bucket} />
      <Sep />
      <Pair k="PFX" v={prefix} />
      <Sep />
      <Pair k="WG" v={workgroup} />
      <Sep />
      <Pair k="REG" v={region} />
      <Sep className="ml-auto" />
      {mock && (
        <>
          <span className="tok tok-warn">mock identity</span>
          <Sep />
        </>
      )}
      <Pair k="UTC" v={clock} mono />
    </footer>
  );
}

function Sep({ className = "" }: { className?: string }) {
  return <span className={`sb-sep ${className}`} aria-hidden>│</span>;
}

function Pair({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="sb-pair">
      <span className="sb-key">{k}</span>
      <span className={`sb-val ${mono ? "mono tnum" : ""} truncate`}>{v}</span>
    </span>
  );
}

function useClock(): string {
  const [now, setNow] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = window.setInterval(() => setNow(formatClock(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function formatClock(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function lastRoleSegment(roleArn?: string): string {
  if (!roleArn) return "role";
  const tail = roleArn.split("/").pop();
  return tail || "role";
}

function computeInitials(name?: string): string {
  if (!name) return "??";
  const chars = name
    .split(/[\s-]+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return chars.toUpperCase() || "??";
}

function BrandGlyph() {
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden>
      <defs>
        <linearGradient id="bg-rust" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--rust-400)" />
          <stop offset="1" stopColor="var(--rust-600)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="2" fill="none" stroke="var(--ink-500)" />
      <path
        d="M6 21 L14 6 L22 21 M9.4 15.5 H18.6"
        fill="none"
        stroke="url(#bg-rust)"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
      <circle cx="14" cy="14" r="0.9" fill="var(--phosphor-500)" />
    </svg>
  );
}
