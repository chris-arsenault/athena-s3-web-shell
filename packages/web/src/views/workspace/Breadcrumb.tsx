import "./Breadcrumb.css";

interface Props {
  prefix: string;
  root: string;
  onNavigate: (next: string) => void;
}

export function Breadcrumb({ prefix, root, onNavigate }: Props) {
  const within = prefix.startsWith(root) ? prefix.slice(root.length) : prefix;
  const parts = within.split("/").filter(Boolean);

  return (
    <nav className="path flex-col gap-1" aria-label="Path">
      <div className="tracked path-label">Location</div>
      <div className="path-row flex-row">
        <span className="path-sigil" aria-hidden>/</span>
        <button className="crumb crumb-root" onClick={() => onNavigate(root)}>
          {root}
        </button>
        {parts.map((part, i) => {
          const next = root + parts.slice(0, i + 1).join("/") + "/";
          const isLast = i === parts.length - 1;
          return (
            <span key={next} className="flex-row">
              <span className="crumb-sep" aria-hidden>›</span>
              <button
                className={`crumb ${isLast ? "crumb-current" : ""}`}
                onClick={() => onNavigate(next)}
              >
                {part}
              </button>
            </span>
          );
        })}
        <span className="path-cursor" aria-hidden>_</span>
      </div>
    </nav>
  );
}
