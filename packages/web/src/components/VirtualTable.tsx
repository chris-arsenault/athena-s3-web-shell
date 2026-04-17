import { useEffect, useRef, useState } from "react";

import type { ResultColumn } from "@athena-shell/shared";

/**
 * Hand-rolled row-virtualized table — no react-window dep. Each row is a
 * fixed-height grid row; the body is position:relative with a total-height
 * sizer so only visible rows + overscan are mounted.
 *
 * Classnames match the original `.vt-*` selectors in
 * `views/query/ResultsTable.css` so the CSS stays in one place.
 */

const ROW_HEIGHT = 28;
const OVERSCAN_ROWS = 10;
const DEFAULT_VIEWPORT = 480;

export interface VirtualTableProps {
  columns: ResultColumn[];
  rows: string[][];
  onHeaderFilterClick?: (column: string, anchor: DOMRect) => void;
  activeFilterColumns?: ReadonlySet<string>;
  draggableHeaders?: boolean;
}

export function VirtualTable(props: VirtualTableProps) {
  const { columns, rows } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewportHeight(el.clientHeight || DEFAULT_VIEWPORT);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = rows.length;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const lastExclusive = Math.min(
    total,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
  );
  const visible = rows.slice(first, lastExclusive);

  const gridTemplate = `48px ${columns.map(() => "minmax(120px, 1fr)").join(" ")}`;

  return (
    <div
      ref={scrollRef}
      className="vt-scroll"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* eslint-disable-next-line local/no-inline-styles */}
      <div className="vt-head" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="vt-th vt-th-idx" />
        {columns.map((c) => (
          <ColumnHeader
            key={c.name}
            column={c}
            active={props.activeFilterColumns?.has(c.name) ?? false}
            onFilterClick={props.onHeaderFilterClick}
            draggable={props.draggableHeaders}
          />
        ))}
      </div>
      {/* eslint-disable-next-line local/no-inline-styles */}
      <div className="vt-body" style={{ height: total * ROW_HEIGHT }}>
        {visible.map((row, i) => {
          const absoluteIndex = first + i;
          return (
            <div
              key={absoluteIndex}
              className="vt-row"
              /* eslint-disable-next-line local/no-inline-styles */
              style={{
                top: absoluteIndex * ROW_HEIGHT,
                gridTemplateColumns: gridTemplate,
              }}
            >
              <div className="vt-cell vt-cell-idx mono">
                {String(absoluteIndex + 1).padStart(3, "0")}
              </div>
              {row.map((cell, j) => (
                <div key={j} className="vt-cell">
                  {cell}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ColumnHeaderProps {
  column: ResultColumn;
  active: boolean;
  onFilterClick?: (column: string, anchor: DOMRect) => void;
  draggable?: boolean;
}

function ColumnHeader({ column, active, onFilterClick, draggable }: ColumnHeaderProps) {
  return (
    <div
      className={`vt-th ${active ? "is-filtered" : ""}`}
      draggable={draggable}
      onDragStart={(e) => {
        if (draggable) {
          e.dataTransfer.setData("text/column", column.name);
          e.dataTransfer.effectAllowed = "copy";
        }
      }}
    >
      <span className="vt-th-name">{column.name}</span>
      <span className="vt-th-type">{column.type}</span>
      {onFilterClick && (
        <button
          className={`vt-th-filter ${active ? "is-active" : ""}`}
          aria-label={`filter ${column.name}`}
          data-testid={`vt-filter-${column.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onFilterClick(column.name, e.currentTarget.getBoundingClientRect());
          }}
        >
          ⏷
        </button>
      )}
    </div>
  );
}
