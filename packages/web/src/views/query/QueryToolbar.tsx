import "./QueryToolbar.css";

interface Props {
  status: string;
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function QueryToolbar({ status, isRunning, onRun, onStop }: Props) {
  const lower = status.toLowerCase();
  const isIdle = lower === "idle" || lower === "";
  return (
    <div className={`qbar flex-row gap-3 ${isRunning ? "is-running" : ""}`}>
      <span className="qbar-slot tracked">
        <span>00</span>
        <span className="qbar-slot-label">engine</span>
      </span>
      <span className="tok tok-accent">athena</span>

      <div className="qbar-sep" aria-hidden />

      <button className="qbtn-run" onClick={onRun} disabled={isRunning}>
        <span className="qbtn-run-glyph" aria-hidden>
          {isRunning ? (
            <span className="qbtn-spin">
              <span /><span /><span />
            </span>
          ) : (
            "▶"
          )}
        </span>
        <span className="qbtn-run-label">
          {isRunning ? "executing" : "execute"}
        </span>
        <span className="kbd qbtn-run-kbd">⌘ ↵</span>
      </button>

      <button className="btn btn-danger qbtn-stop" onClick={onStop} disabled={!isRunning}>
        <span aria-hidden>■</span>
        <span>abort</span>
      </button>

      <div className="qbar-sweep" aria-hidden />

      <span className="qbar-status ml-auto" data-state={lower || "idle"}>
        <span className="tracked qbar-status-label">state</span>
        {isIdle ? (
          <span className="tok">ready</span>
        ) : (
          <span className={`tok tok-${tokClass(lower)}`}>
            {status}
          </span>
        )}
      </span>
    </div>
  );
}

function tokClass(state: string): "live" | "warn" | "danger" | "info" {
  if (state === "succeeded") return "live";
  if (state === "running" || state === "queued") return "warn";
  if (state === "failed" || state === "cancelled") return "danger";
  return "info";
}
