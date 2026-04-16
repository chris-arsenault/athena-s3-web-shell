import "./EmptyState.css";

interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
}

export function EmptyState({ icon = "∅", title, hint }: EmptyStateProps) {
  return (
    <div className="empty-state flex-col gap-2">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint text-muted text-sm">{hint}</div>}
    </div>
  );
}
