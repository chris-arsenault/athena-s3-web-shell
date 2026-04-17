import "./QueryToolbar.css";

interface Props {
  status: string;
  isRunning: boolean;
  onRunStatement: () => void;
  onRunAll: () => void;
  onStop: () => void;
  onSaveNamed: () => void;
  canSave: boolean;
  stopOnFailure: boolean;
  onToggleStopOnFailure: () => void;
  /** Scratchpad-backed tab only. Undefined → button hidden. */
  onSaveFile?: () => void;
  fileDirty?: boolean;
}

export function QueryToolbar(props: Props) {
  const { status, isRunning } = props;
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

      <RunControls {...props} />

      <button
        className="btn btn-danger qbtn-stop"
        onClick={props.onStop}
        disabled={!isRunning}
      >
        <span aria-hidden>■</span>
        <span>abort</span>
      </button>

      <div className="qbar-sep" aria-hidden />

      {props.onSaveFile && (
        <button
          className={`btn qbtn-save-file ${props.fileDirty ? "is-dirty" : ""}`}
          onClick={props.onSaveFile}
          data-testid="qbtn-save-file"
          title="Save scratchpad file to S3 (⌘S)"
        >
          <span aria-hidden>💾</span>
          <span>save file</span>
          <span className="kbd qbtn-sub-kbd">⌘ S</span>
        </button>
      )}

      <button
        className="btn qbtn-save"
        onClick={props.onSaveNamed}
        disabled={!props.canSave}
        data-testid="qbtn-save"
        title="Save as a named query"
      >
        <span aria-hidden>◆</span>
        <span>save named</span>
      </button>

      <label className="qbar-toggle" data-testid="qbar-stop-on-fail">
        <input
          type="checkbox"
          checked={props.stopOnFailure}
          onChange={props.onToggleStopOnFailure}
        />
        <span className="tracked">stop on fail</span>
      </label>

      <div className="qbar-sweep" aria-hidden />

      <span className="qbar-status ml-auto" data-state={lower || "idle"}>
        <span className="tracked qbar-status-label">state</span>
        {isIdle ? (
          <span className="tok">ready</span>
        ) : (
          <span className={`tok tok-${tokClass(lower)}`}>{status}</span>
        )}
      </span>
    </div>
  );
}

function RunControls({
  isRunning,
  onRunStatement,
  onRunAll,
}: {
  isRunning: boolean;
  onRunStatement: () => void;
  onRunAll: () => void;
}) {
  return (
    <div className="qbtn-run-group flex-row gap-1">
      <button
        className="qbtn-run"
        onClick={onRunStatement}
        disabled={isRunning}
        data-testid="qbtn-run-statement"
        title="Run statement under cursor — or highlight text and use ⌘⌥↵ for a selection"
      >
        <span className="qbtn-run-glyph" aria-hidden>
          {isRunning ? (
            <span className="qbtn-spin">
              <span />
              <span />
              <span />
            </span>
          ) : (
            "▶"
          )}
        </span>
        <span className="qbtn-run-label">
          {isRunning ? "executing" : "run statement"}
        </span>
        <span className="kbd qbtn-run-kbd">⌘ ↵</span>
      </button>
      <button
        className="btn qbtn-run-all"
        onClick={onRunAll}
        disabled={isRunning}
        data-testid="qbtn-run-all"
        title="Run every statement in this tab, sequentially"
      >
        <span aria-hidden>▶▶</span>
        <span>run all</span>
        <span className="kbd qbtn-sub-kbd">⌘ ⇧ ↵</span>
      </button>
    </div>
  );
}

function tokClass(state: string): "live" | "warn" | "danger" | "info" {
  if (state === "succeeded") return "live";
  if (state === "running" || state === "queued") return "warn";
  if (state === "failed" || state === "cancelled") return "danger";
  return "info";
}
