import "./LoadingSpinner.css";

export function LoadingSpinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap flex-row gap-2" role="status" aria-live="polite">
      <span className="spinner-bracket">[</span>
      <span className="spinner-bars" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="spinner-label tracked">{label ?? "loading"}</span>
      <span className="spinner-dots" aria-hidden />
      <span className="spinner-bracket">]</span>
    </div>
  );
}
