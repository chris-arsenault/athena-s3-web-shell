import "./ErrorBanner.css";

interface Props {
  error: Error | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  if (!error) return null;
  return (
    <div className="error-banner flex-row gap-2" role="alert">
      <span>⚠️</span>
      <span className="flex-1 truncate">{error.message}</span>
      {onDismiss && (
        <button className="error-dismiss" onClick={onDismiss}>
          ✕
        </button>
      )}
    </div>
  );
}
