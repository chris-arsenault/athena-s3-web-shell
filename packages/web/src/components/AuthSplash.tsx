import "./AuthSplash.css";

interface Props {
  message?: string;
  error?: Error | null;
}

export function AuthSplash({ message = "establishing session", error }: Props) {
  return (
    <div className="splash">
      <div className="splash-mark" aria-hidden>
        <BrandGlyph />
      </div>
      <div className="splash-word">
        athena<span className="splash-sep">·</span>
        <span className="splash-sub">shell</span>
      </div>
      {error ? (
        <div className="splash-error tracked">
          <span className="tok tok-danger">auth fault</span>
          <span className="splash-error-msg mono">{error.message}</span>
        </div>
      ) : (
        <div className="splash-status tracked">
          <span className="dot" aria-hidden />
          <span>{message}</span>
          <span className="splash-blink" aria-hidden>_</span>
        </div>
      )}
    </div>
  );
}

function BrandGlyph() {
  return (
    <svg viewBox="0 0 28 28" width="44" height="44" aria-hidden>
      <defs>
        <linearGradient id="splash-rust" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--rust-400)" />
          <stop offset="1" stopColor="var(--rust-600)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="27" height="27" rx="2" fill="none" stroke="var(--ink-500)" />
      <path
        d="M6 21 L14 6 L22 21 M9.4 15.5 H18.6"
        fill="none"
        stroke="url(#splash-rust)"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
      <circle cx="14" cy="14" r="0.9" fill="var(--phosphor-500)" />
    </svg>
  );
}
