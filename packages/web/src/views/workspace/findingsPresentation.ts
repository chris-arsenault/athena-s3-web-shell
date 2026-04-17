import type { Finding } from "@athena-shell/shared";

export interface ResolveState {
  replaceExisting: boolean;
  stringOverrides: Set<number>;
  acceptedNullFormat?: string;
  acceptedSerdeSwap: boolean;
  dismissedAdvisoryKeys: Set<string>;
}

export function keyOf(f: Finding): string {
  switch (f.kind) {
    case "type-mismatch":
    case "null-token":
      return `${f.kind}:${f.column}`;
    case "duplicate-table":
    case "mixed-parent":
    case "json-array":
    case "serde-mismatch":
      return f.kind;
  }
}

export function hasUnresolvedBlock(findings: Finding[], state: ResolveState): boolean {
  for (const f of findings) {
    if (f.severity !== "block") continue;
    if (f.kind === "duplicate-table" && state.replaceExisting) continue;
    return true;
  }
  return false;
}

/**
 * True when any advisory finding is still open. Splits each kind's
 * resolve check into a tiny helper so the dispatch stays flat (complexity
 * budget wants ≤10 branches per function).
 */
export function hasUnresolvedAdvisory(
  findings: Finding[],
  state: ResolveState,
  columnIndexByName: Record<string, number>
): boolean {
  for (const f of findings) {
    if (f.severity !== "advisory") continue;
    if (state.dismissedAdvisoryKeys.has(keyOf(f))) continue;
    if (!isAdvisoryResolved(f, state, columnIndexByName)) return true;
  }
  return false;
}

function isAdvisoryResolved(
  f: Finding,
  state: ResolveState,
  columnIndexByName: Record<string, number>
): boolean {
  if (f.kind === "type-mismatch") {
    const idx = columnIndexByName[f.column] ?? -1;
    return idx >= 0 && state.stringOverrides.has(idx);
  }
  if (f.kind === "null-token") return state.acceptedNullFormat === f.token;
  if (f.kind === "serde-mismatch") return state.acceptedSerdeSwap;
  return false;
}
