import { useEffect, useRef, useState } from "react";

import type { Tab } from "./useTabs";
import "./TabStrip.css";

interface Props {
  tabs: Tab[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => void;
}

export function TabStrip({ tabs, activeId, onActivate, onClose, onNew, onRename }: Props) {
  return (
    <div className="tabstrip" data-testid="tabstrip">
      <ul className="tabstrip-list">
        {tabs.map((t) => (
          <TabItem
            key={t.id}
            tab={t}
            active={t.id === activeId}
            onActivate={() => onActivate(t.id)}
            onClose={() => onClose(t.id)}
            onRename={(name) => onRename(t.id, name)}
          />
        ))}
      </ul>
      <button
        className="tabstrip-new"
        aria-label="New tab"
        onClick={onNew}
        data-testid="tab-new"
      >
        +
      </button>
    </div>
  );
}

interface ItemProps {
  tab: Tab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

function isDirty(tab: Tab): boolean {
  if (!tab.source) return false;
  return tab.sql !== (tab.savedSql ?? "");
}

function TabItem({ tab, active, onActivate, onClose, onRename }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(tab.name);
  }, [tab.name, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.name) onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      className={`tabstrip-item reg ${active ? "is-active" : ""}`}
      data-testid={`tab-${tab.id}`}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="tabstrip-rename"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(tab.name);
              setEditing(false);
            }
          }}
          data-testid={`tab-rename-${tab.id}`}
        />
      ) : (
        <button
          className="tabstrip-pick"
          onClick={onActivate}
          onDoubleClick={() => setEditing(true)}
          data-testid={`tab-pick-${tab.id}`}
        >
          <span className="tabstrip-kind mono" aria-hidden>
            {tab.kind === "browser" ? "▣" : tab.source ? "≡" : ">_"}
          </span>
          {isDirty(tab) && (
            <span className="tabstrip-dirty" data-testid={`tab-dirty-${tab.id}`} aria-label="unsaved">
              ●
            </span>
          )}
          <span className="tabstrip-name mono truncate">{tab.name}</span>
        </button>
      )}
      <button
        className="tabstrip-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${tab.name}`}
        data-testid={`tab-close-${tab.id}`}
      >
        ×
      </button>
    </li>
  );
}
