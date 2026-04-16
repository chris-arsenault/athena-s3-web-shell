import "./EmptyState.css";

interface EmptyStateProps {
  icon?: string;
  title: string;
  hint?: string;
}

export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="empty-wrap">
      <div className="empty reg flex-col gap-3">
        <div className="empty-header tracked">
          <span>idle</span>
          <span className="empty-rule" aria-hidden />
          <span className="mono">no data</span>
        </div>
        {icon && (
          <div className="empty-glyph" aria-hidden>
            <span className="empty-bracket">&#x2039;</span>
            <span className="empty-icon">{icon}</span>
            <span className="empty-bracket">&#x203A;</span>
          </div>
        )}
        <div className="empty-title serif">{title}</div>
        {hint && <div className="empty-hint mono text-muted">{hint}</div>}
        <div className="empty-foot tracked">
          <span>stand by</span>
          <span className="empty-blink" aria-hidden>_</span>
        </div>
      </div>
    </div>
  );
}
