import { useCallback, useEffect, useMemo, useState } from "react";

import type { AuthContext } from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { useAuth } from "../../auth/authContext";
import { listFolder } from "../../data/s3Repo";
import "./WorkspaceSection.css";

interface Props {
  onOpen: (prefix: string) => void;
  activePrefix: string | null;
}

/**
 * Lightweight folder-tree inside the side panel. Shows the workspace
 * root + immediate children; folders expand in place to reveal their
 * children. Click a folder → opens a browser tab in the main area.
 *
 * Intentionally NOT a full recursive tree — the file browser itself
 * handles deep navigation. The sidebar is a shortcut surface.
 */
export function WorkspaceSection({ onOpen, activePrefix }: Props) {
  const { provider, context } = useAuth();
  if (!context) return null;
  return (
    <WorkspaceTree
      provider={provider}
      context={context}
      onOpen={onOpen}
      activePrefix={activePrefix}
    />
  );
}

interface TreeProps {
  provider: AuthProvider;
  context: AuthContext;
  onOpen: (p: string) => void;
  activePrefix: string | null;
}

function WorkspaceTree({ provider, context, onOpen, activePrefix }: TreeProps) {
  const root = context.s3.prefix;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]));
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<Set<string>>(() => new Set());

  const load = useCallback(
    async (prefix: string) => {
      if (folders[prefix] !== undefined) return;
      setLoading((prev) => new Set(prev).add(prefix));
      try {
        const listing = await listFolder(provider, context, prefix).catch(() => null);
        const children = (listing?.folders ?? []).map((f) => f.key);
        setFolders((prev) => ({ ...prev, [prefix]: children }));
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(prefix);
          return next;
        });
      }
    },
    [provider, context, folders]
  );

  useEffect(() => {
    void load(root);
  }, [load, root]);

  const toggleOrOpen = (prefix: string) => {
    const wasExpanded = expanded.has(prefix);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (wasExpanded) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
    if (!wasExpanded) void load(prefix);
    onOpen(prefix);
  };

  return (
    <ul className="ws-tree" role="tree">
      <TreeRow
        prefix={root}
        label="/"
        depth={0}
        isRoot
        expanded={expanded.has(root)}
        active={activePrefix === root}
        loading={loading.has(root)}
        onToggle={() => toggleOrOpen(root)}
      />
      {expanded.has(root) && (folders[root] ?? []).map((p) => (
        <TreeBranch
          key={p}
          prefix={p}
          depth={1}
          expanded={expanded}
          folders={folders}
          loading={loading}
          activePrefix={activePrefix}
          onToggle={toggleOrOpen}
        />
      ))}
    </ul>
  );
}

interface BranchProps {
  prefix: string;
  depth: number;
  expanded: Set<string>;
  folders: Record<string, string[]>;
  loading: Set<string>;
  activePrefix: string | null;
  onToggle: (prefix: string) => void;
}

function TreeBranch(p: BranchProps) {
  const label = lastSegment(p.prefix);
  const isOpen = p.expanded.has(p.prefix);
  const children = p.folders[p.prefix];
  return (
    <>
      <TreeRow
        prefix={p.prefix}
        label={label}
        depth={p.depth}
        expanded={isOpen}
        active={p.activePrefix === p.prefix}
        loading={p.loading.has(p.prefix)}
        onToggle={() => p.onToggle(p.prefix)}
      />
      {isOpen && children && children.map((child) => (
        <TreeBranch
          key={child}
          {...p}
          prefix={child}
          depth={p.depth + 1}
        />
      ))}
    </>
  );
}

interface RowProps {
  prefix: string;
  label: string;
  depth: number;
  isRoot?: boolean;
  expanded: boolean;
  active: boolean;
  loading: boolean;
  onToggle: () => void;
}

function TreeRow(p: RowProps) {
  // depth → indent in pixels, injected as a CSS variable so the style
  // prop itself is data-only (satisfies local/no-inline-styles).
  const styleVar = useMemo(
    // eslint-disable-next-line local/no-inline-styles
    () => ({ ["--ws-indent" as string]: `${p.depth * 14 + 8}px` }),
    [p.depth]
  );
  const classes = [
    "ws-row",
    p.active ? "is-active" : "",
    p.isRoot ? "is-root" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li
      className={classes}
      // Dynamic depth-to-indent: passed as a CSS custom property
      // (--ws-indent) so the actual styling still lives in the CSS file.
      // eslint-disable-next-line local/no-inline-styles
      style={styleVar}
      role="treeitem"
      aria-expanded={p.expanded}
      aria-selected={p.active}
    >
      <button
        type="button"
        className="ws-row-btn"
        onClick={p.onToggle}
        data-testid={`ws-row-${p.prefix}`}
      >
        <span className="ws-row-chev mono" aria-hidden>
          {p.loading ? "…" : p.expanded ? "▾" : "▸"}
        </span>
        <span className="ws-row-glyph" aria-hidden>
          {p.isRoot ? "▣" : "▸"}
        </span>
        <span className="ws-row-name mono truncate">{p.label}</span>
      </button>
    </li>
  );
}

function lastSegment(prefix: string): string {
  const trimmed = prefix.replace(/\/$/, "");
  if (!trimmed) return "/";
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return last ? `${last}/` : "/";
}
