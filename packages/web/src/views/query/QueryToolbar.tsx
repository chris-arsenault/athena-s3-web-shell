import "./QueryToolbar.css";

interface Props {
  status: string;
  isRunning: boolean;
  onRun: () => void;
  onStop: () => void;
}

export function QueryToolbar({ status, isRunning, onRun, onStop }: Props) {
  return (
    <div className="query-toolbar flex-row gap-2">
      <button className="btn" onClick={onRun} disabled={isRunning}>
        {isRunning ? "Running…" : "▶ Run"}
      </button>
      <button className="btn btn-secondary" onClick={onStop} disabled={!isRunning}>
        ■ Stop
      </button>
      <span className={`query-status ml-auto status-${status.toLowerCase()}`}>
        {status === "idle" ? "" : status}
      </span>
    </div>
  );
}
