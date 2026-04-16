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
    <nav className="breadcrumb flex-row gap-1" aria-label="Path">
      <button className="crumb" onClick={() => onNavigate(root)}>
        {root}
      </button>
      {parts.map((part, i) => {
        const next = root + parts.slice(0, i + 1).join("/") + "/";
        return (
          <span key={next} className="flex-row gap-1">
            <span className="crumb-sep">/</span>
            <button className="crumb" onClick={() => onNavigate(next)}>
              {part}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
