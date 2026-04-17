import type {
  Finding,
  NullTokenFinding,
  SerdeMismatchFinding,
} from "@athena-shell/shared";

import {
  keyOf,
  hasUnresolvedAdvisory,
  hasUnresolvedBlock,
  type ResolveState,
} from "./findingsPresentation";

export { keyOf, hasUnresolvedAdvisory, hasUnresolvedBlock };
export type { ResolveState };

interface Props {
  findings: Finding[];
  columnIndexByName: Record<string, number>;
  state: ResolveState;
  onReplaceExistingToggle: (next: boolean) => void;
  onOverrideColumn: (columnIndex: number) => void;
  onAcceptNullFormat: (token: string) => void;
  onAcceptSerdeSwap: () => void;
  onDismiss: (key: string) => void;
}

export function FindingsPanel(props: Props) {
  const { findings, state } = props;
  const visible = findings.filter((f) => !state.dismissedAdvisoryKeys.has(keyOf(f)));
  if (visible.length === 0) {
    return (
      <div className="ct-findings ct-findings-empty">
        <span className="tok tok-live">clean</span>
        <span className="text-muted mono">no findings</span>
      </div>
    );
  }
  return (
    <div className="ct-findings">
      <div className="ct-findings-head">
        <span className="tracked">findings</span>
        <span className="text-muted mono">{visible.length}</span>
      </div>
      <ul className="ct-findings-list">
        {visible.map((f) => (
          <li key={keyOf(f)} className={`ct-finding ct-finding-${f.severity}`}>
            <FindingRow finding={f} {...props} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingRow(props: Props & { finding: Finding }) {
  const { finding } = props;
  switch (finding.kind) {
    case "duplicate-table":
      return (
        <DuplicateTableRow
          message={finding.message}
          replaceExisting={props.state.replaceExisting}
          onToggle={props.onReplaceExistingToggle}
        />
      );
    case "mixed-parent":
      return (
        <>
          <span className="tok tok-danger">block</span>
          <span className="mono ct-finding-msg">{finding.message}</span>
          <span className="text-muted mono">
            {finding.siblingFileNames.slice(0, 3).join(", ")}
            {finding.siblingFileNames.length > 3 ? "…" : ""}
          </span>
        </>
      );
    case "json-array":
      return <JsonArrayRow commands={finding.suggestedCommands} message={finding.message} />;
    case "type-mismatch":
      return <TypeMismatchRow {...props} finding={finding} />;
    case "null-token":
      return (
        <NullTokenRow
          finding={finding}
          accepted={props.state.acceptedNullFormat === finding.token}
          onAccept={() => props.onAcceptNullFormat(finding.token)}
          onDismiss={() => props.onDismiss(keyOf(finding))}
        />
      );
    case "serde-mismatch":
      return (
        <SerdeMismatchRow
          finding={finding}
          accepted={props.state.acceptedSerdeSwap}
          onAccept={props.onAcceptSerdeSwap}
          onDismiss={() => props.onDismiss(keyOf(finding))}
        />
      );
  }
}

function DuplicateTableRow({
  message,
  replaceExisting,
  onToggle,
}: {
  message: string;
  replaceExisting: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <>
      <span className="tok tok-danger">block</span>
      <span className="mono ct-finding-msg">{message}</span>
      <label className="ct-finding-action">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span>replace existing</span>
      </label>
    </>
  );
}

function JsonArrayRow({ commands, message }: { commands: string[]; message: string }) {
  return (
    <>
      <span className="tok tok-danger">block</span>
      <div className="ct-finding-col">
        <span className="mono ct-finding-msg">{message}</span>
        <pre className="ct-finding-cmd mono">{commands.join("\n")}</pre>
      </div>
    </>
  );
}

function TypeMismatchRow({
  finding,
  state,
  columnIndexByName,
  onOverrideColumn,
  onDismiss,
}: Props & { finding: Extract<Finding, { kind: "type-mismatch" }> }) {
  const idx = columnIndexByName[finding.column] ?? -1;
  const resolved = state.stringOverrides.has(idx);
  return (
    <>
      <span className="tok tok-warn">warn</span>
      <span className="mono ct-finding-msg">{finding.message}</span>
      <button
        className="btn btn-small"
        disabled={resolved || idx < 0}
        onClick={() => onOverrideColumn(idx)}
      >
        {resolved ? "overridden → STRING" : "override to STRING"}
      </button>
      {!resolved && <DismissButton onClick={() => onDismiss(keyOf(finding))} />}
    </>
  );
}

function NullTokenRow({
  finding,
  accepted,
  onAccept,
  onDismiss,
}: {
  finding: NullTokenFinding;
  accepted: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <span className="tok tok-warn">warn</span>
      <span className="mono ct-finding-msg">{finding.message}</span>
      <button className="btn btn-small" disabled={accepted} onClick={onAccept}>
        {accepted ? `treating '${finding.token}' as NULL` : `treat '${finding.token}' as NULL`}
      </button>
      {!accepted && <DismissButton onClick={onDismiss} />}
    </>
  );
}

function SerdeMismatchRow({
  finding,
  accepted,
  onAccept,
  onDismiss,
}: {
  finding: SerdeMismatchFinding;
  accepted: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <span className="tok tok-warn">warn</span>
      <span className="mono ct-finding-msg">{finding.message}</span>
      <button className="btn btn-small" disabled={accepted} onClick={onAccept}>
        {accepted ? "swapped" : "swap SerDe"}
      </button>
      {!accepted && <DismissButton onClick={onDismiss} />}
    </>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn btn-small btn-ghost" onClick={onClick} title="dismiss">
      dismiss
    </button>
  );
}
