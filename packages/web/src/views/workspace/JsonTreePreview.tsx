import { useMemo, useState } from "react";

import type { S3Object } from "@athena-shell/shared";

import {
  ErrorPanel,
  LoadingPanel,
  ParseErrorChip,
  RawToggle,
} from "./FilePreview";
import { isFailure, parseJsonTree, type JsonNode } from "./previewParsers";
import { TextBody, useTextContent } from "./TextPreview";

interface Props {
  file: S3Object;
}

const ARRAY_COLLAPSE_THRESHOLD = 100;

export function JsonTreePreview({ file }: Props) {
  const [raw, setRaw] = useState(false);
  const content = useTextContent(file.key);
  const parsed = useMemo(() => {
    if (content.state !== "ready") return null;
    return parseJsonTree(content.value.text);
  }, [content]);

  if (content.state === "loading") return <LoadingPanel />;
  if (content.state === "error") return <ErrorPanel message={content.error} />;
  const parseError = parsed && isFailure(parsed) ? parsed.error : null;
  const showRaw = raw || !!parseError;

  return (
    <div className="fp-json">
      <div className="fp-table-head">
        <RawToggle raw={showRaw} onChange={setRaw} parsedLabel="tree" />
        {parseError && <ParseErrorChip message={parseError} />}
      </div>
      {showRaw || !parsed || isFailure(parsed) ? (
        <TextBody text={content.value.text} />
      ) : (
        <ul className="fp-tree" data-testid="fp-json-tree">
          <TreeNode node={parsed.root} label="root" />
        </ul>
      )}
    </div>
  );
}

interface NodeProps {
  node: JsonNode;
  label: string;
}

function TreeNode({ node, label }: NodeProps) {
  const [open, setOpen] = useState(true);
  if (isPrimitive(node)) {
    return <PrimitiveRow label={label} node={node} />;
  }
  return (
    <li className="fp-tree-row">
      <button className="fp-tree-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="fp-tree-caret">{open ? "▾" : "▸"}</span>
        <span className="fp-tree-key mono">{label}</span>
        <span className={`fp-tree-kind fp-tree-kind-${node.kind}`}>{node.kind}</span>
        <span className="fp-tree-summary mono text-dim">{summarize(node)}</span>
      </button>
      {open && <ContainerChildren node={node} />}
    </li>
  );
}

function ContainerChildren({ node }: { node: JsonNode }) {
  if (node.kind === "obj") {
    return (
      <ul className="fp-tree-children">
        {node.entries.map(([k, v]) => (
          <TreeNode key={k} node={v} label={k} />
        ))}
      </ul>
    );
  }
  if (node.kind === "arr") return <ArrayChildren node={node} />;
  return null;
}

function ArrayChildren({ node }: { node: JsonNode & { kind: "arr" } }) {
  const [showAll, setShowAll] = useState(false);
  const shown =
    !showAll && node.items.length > ARRAY_COLLAPSE_THRESHOLD
      ? node.items.slice(0, ARRAY_COLLAPSE_THRESHOLD)
      : node.items;
  return (
    <ul className="fp-tree-children">
      {shown.map((v, i) => (
        <TreeNode key={i} node={v} label={`[${i}]`} />
      ))}
      {!showAll && node.items.length > ARRAY_COLLAPSE_THRESHOLD && (
        <li className="fp-tree-row">
          <button className="fp-tree-more mono" onClick={() => setShowAll(true)}>
            Show all {node.items.length} items
          </button>
        </li>
      )}
    </ul>
  );
}

function PrimitiveRow({ label, node }: { label: string; node: JsonNode }) {
  return (
    <li className="fp-tree-row fp-tree-leaf">
      <span className="fp-tree-key mono">{label}</span>
      <span className={`fp-tree-kind fp-tree-kind-${node.kind}`}>{node.kind}</span>
      <span className="fp-tree-value mono truncate">{primitiveString(node)}</span>
    </li>
  );
}

function isPrimitive(node: JsonNode): boolean {
  return node.kind !== "obj" && node.kind !== "arr";
}

function primitiveString(node: JsonNode): string {
  if (node.kind === "str") return JSON.stringify(node.value);
  if (node.kind === "num") return String(node.value);
  if (node.kind === "bool") return node.value ? "true" : "false";
  return "null";
}

function summarize(node: JsonNode): string {
  if (node.kind === "obj") return `{ ${node.entries.length} keys }`;
  if (node.kind === "arr") return `[ ${node.items.length} items ]`;
  return "";
}
