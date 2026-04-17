import { useCallback, useEffect, useState, type ReactNode } from "react";

import "./SidePanelSection.css";

interface Props {
  /** Short tracked label rendered as [ TITLE ]. */
  title: string;
  /** Optional trailing metadata chip, e.g. an item count or status token. */
  meta?: ReactNode;
  /** Persistence key; when set, collapse state survives reloads. */
  persistKey?: string;
  /** Initial collapsed state when there's no persisted value. */
  defaultCollapsed?: boolean;
  /** Fills the remaining height of its container. Use on exactly one
   *  section per panel so the side panel doesn't wind up scroll-locked. */
  grow?: boolean;
  children: ReactNode;
}

/**
 * Collapsible side-panel section — the IDE grammar the console was
 * reaching for. Bracketed header matches the .tok token style so
 * Catalog/Library/Scratchpad feel like the same family.
 */
export function SidePanelSection({
  title,
  meta,
  persistKey,
  defaultCollapsed = false,
  grow = false,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    readPersisted(persistKey, defaultCollapsed)
  );

  useEffect(() => {
    if (!persistKey) return;
    try {
      window.localStorage.setItem(
        `athena-shell.side.${persistKey}`,
        collapsed ? "1" : "0"
      );
    } catch {
      // storage disabled; in-memory state still works
    }
  }, [persistKey, collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);
  const classes = [
    "side-section",
    collapsed ? "is-collapsed" : "",
    grow && !collapsed ? "is-grow" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} data-testid={`side-${persistKey ?? title}`}>
      <button
        className="side-section-head"
        onClick={toggle}
        aria-expanded={!collapsed}
      >
        <span className="side-section-chevron" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="side-section-title tracked">{title}</span>
        {meta && <span className="side-section-meta mono">{meta}</span>}
      </button>
      {!collapsed && <div className="side-section-body">{children}</div>}
    </section>
  );
}

function readPersisted(key: string | undefined, fallback: boolean): boolean {
  if (!key) return fallback;
  try {
    const v = window.localStorage.getItem(`athena-shell.side.${key}`);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}
