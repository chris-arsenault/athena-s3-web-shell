import { useEffect, useMemo, useRef, useState } from "react";

import type { ResultColumn } from "@athena-shell/shared";

import { distinctValues, type ColumnFilter } from "./resultFilters";
import "./ColumnFilterPopover.css";

interface Props {
  column: ResultColumn;
  columnIndex: number;
  rows: readonly string[][];
  filter: ColumnFilter;
  onChange: (next: ColumnFilter) => void;
  onClose: () => void;
  anchor: DOMRect;
}

export function ColumnFilterPopover(props: Props) {
  const { column, columnIndex, rows, filter, onChange, onClose, anchor } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState(filter.search);
  useDismiss(boxRef, inputRef, onClose);
  useDebouncedSearch(filter, search, onChange);
  const distinct = useMemo(
    () => distinctValues(rows, columnIndex, 100),
    [rows, columnIndex]
  );
  const toggleValue = (v: string) => {
    const next = new Set(filter.values);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange({ ...filter, values: next });
  };
  const clear = () => {
    setSearch("");
    onChange({ search: "", values: new Set() });
  };

  return (
    <div
      ref={boxRef}
      className="cfp"
      /* eslint-disable-next-line local/no-inline-styles */
      style={positionStyle(anchor)}
      role="dialog"
      data-testid={`cfp-${column.name}`}
    >
      <div className="cfp-head">
        <span className="tracked">filter</span>
        <span className="mono text-dim">{column.name}</span>
        <button className="cfp-clear" onClick={clear} data-testid="cfp-clear">
          clear
        </button>
      </div>
      <input
        ref={inputRef}
        className="input cfp-search"
        placeholder="contains…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        data-testid={`cfp-search-${column.name}`}
      />
      <ul className="cfp-list">
        {distinct.map((d) => (
          <li key={d.value} className="cfp-item">
            <label>
              <input
                type="checkbox"
                checked={filter.values.has(d.value)}
                onChange={() => toggleValue(d.value)}
                data-testid={`cfp-val-${column.name}-${d.value}`}
              />
              <span className="cfp-val mono truncate">{d.value || "(empty)"}</span>
              <span className="cfp-count mono text-dim">{d.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useDismiss(
  boxRef: React.RefObject<HTMLDivElement | null>,
  inputRef: React.RefObject<HTMLInputElement | null>,
  onClose: () => void
): void {
  useEffect(() => {
    inputRef.current?.focus();
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, boxRef, inputRef]);
}

function useDebouncedSearch(
  filter: ColumnFilter,
  search: string,
  onChange: (f: ColumnFilter) => void
): void {
  useEffect(() => {
    const t = setTimeout(() => onChange({ ...filter, search }), 100);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
}

function positionStyle(anchor: DOMRect): React.CSSProperties {
  return {
    top: anchor.bottom + 4,
    left: Math.max(8, anchor.left - 8),
  };
}
