import "./LoadingSpinner.css";

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap flex-row gap-2">
      <span className="spinner" aria-hidden />
      {label && <span className="text-muted text-sm">{label}</span>}
    </div>
  );
}
