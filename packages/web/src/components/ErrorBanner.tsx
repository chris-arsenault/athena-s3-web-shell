import "./ErrorBanner.css";

interface Props {
  error: Error | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  if (!error) return null;
  return (
    <div className="alert flex-row gap-3" role="alert">
      <span className="alert-stripe" aria-hidden />
      <span className="tok tok-danger">fault</span>
      <span className="alert-msg mono flex-1 truncate">{error.message}</span>
      {onDismiss && (
        <button className="alert-dismiss" onClick={onDismiss} aria-label="Dismiss">
          [ X ]
        </button>
      )}
    </div>
  );
}
