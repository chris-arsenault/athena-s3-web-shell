import type { ResultColumn } from "@athena-shell/shared";

import {
  allowedAggregations,
  type AggOp,
  type Aggregation,
  type GroupBySpec,
} from "./resultAggregations";
import "./GroupByPanel.css";

interface Props {
  columns: readonly ResultColumn[];
  spec: GroupBySpec;
  onChange: (next: GroupBySpec) => void;
  onClose: () => void;
}

export function GroupByPanel({ columns, spec, onChange, onClose }: Props) {
  const onDropGroup = (e: React.DragEvent) => {
    const name = e.dataTransfer.getData("text/column");
    if (!name || spec.groupBy.includes(name)) return;
    onChange({ ...spec, groupBy: [...spec.groupBy, name] });
  };

  const onDropAgg = (e: React.DragEvent) => {
    const name = e.dataTransfer.getData("text/column");
    if (!name) return;
    const col = columns.find((c) => c.name === name);
    if (!col) return;
    const op: AggOp = allowedAggregations(col)[0]!;
    onChange({ ...spec, aggregations: [...spec.aggregations, { column: name, op }] });
  };

  const removeGroup = (name: string) =>
    onChange({ ...spec, groupBy: spec.groupBy.filter((g) => g !== name) });

  const removeAgg = (idx: number) =>
    onChange({ ...spec, aggregations: spec.aggregations.filter((_, i) => i !== idx) });

  const changeAggOp = (idx: number, op: AggOp) =>
    onChange({
      ...spec,
      aggregations: spec.aggregations.map((a, i) => (i === idx ? { ...a, op } : a)),
    });

  return (
    <div className="gbp" data-testid="groupby-panel">
      <div className="gbp-head">
        <span className="tok tok-accent">group by</span>
        <span className="gbp-head-rule" aria-hidden />
        <button className="gbp-close" onClick={onClose}>
          [ close ]
        </button>
      </div>
      <div className="gbp-zones">
        <Zone
          testid="gbp-zone-group"
          label="group by"
          hint="drag column header here"
          onDrop={onDropGroup}
        >
          {spec.groupBy.map((name) => (
            <GroupChip key={name} name={name} onRemove={() => removeGroup(name)} />
          ))}
        </Zone>
        <Zone
          testid="gbp-zone-agg"
          label="aggregate"
          hint="drag column header here"
          onDrop={onDropAgg}
        >
          {spec.aggregations.map((a, idx) => (
            <AggChip
              key={`${a.column}-${idx}`}
              aggregation={a}
              column={columns.find((c) => c.name === a.column)}
              onChangeOp={(op) => changeAggOp(idx, op)}
              onRemove={() => removeAgg(idx)}
            />
          ))}
        </Zone>
      </div>
    </div>
  );
}

interface ZoneProps {
  testid: string;
  label: string;
  hint: string;
  onDrop: (e: React.DragEvent) => void;
  children: React.ReactNode;
}

function Zone({ testid, label, hint, onDrop, children }: ZoneProps) {
  return (
    <div
      className="gbp-zone"
      data-testid={testid}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/column")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(e);
      }}
    >
      <div className="gbp-zone-label tracked">{label}</div>
      <div className="gbp-zone-body">
        {isEmpty(children) ? (
          <span className="gbp-zone-hint mono text-dim">{hint}</span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function GroupChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="gbp-chip" data-testid={`gbp-chip-group-${name}`}>
      <span className="mono">{name}</span>
      <button className="gbp-chip-x" onClick={onRemove} aria-label={`remove ${name}`}>
        ×
      </button>
    </span>
  );
}

interface AggChipProps {
  aggregation: Aggregation;
  column: ResultColumn | undefined;
  onChangeOp: (op: AggOp) => void;
  onRemove: () => void;
}

function AggChip({ aggregation, column, onChangeOp, onRemove }: AggChipProps) {
  const ops = column ? allowedAggregations(column) : (["COUNT"] as AggOp[]);
  return (
    <span className="gbp-chip" data-testid={`gbp-chip-agg-${aggregation.column}`}>
      <select
        className="gbp-chip-op"
        value={aggregation.op}
        onChange={(e) => onChangeOp(e.target.value as AggOp)}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <span className="mono">{aggregation.column}</span>
      <button className="gbp-chip-x" onClick={onRemove} aria-label={`remove ${aggregation.column}`}>
        ×
      </button>
    </span>
  );
}

function isEmpty(children: React.ReactNode): boolean {
  if (Array.isArray(children)) return children.length === 0;
  return !children;
}
