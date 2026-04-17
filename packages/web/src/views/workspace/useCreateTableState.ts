import { useEffect, useMemo, useState } from "react";

import type {
  AnalyzeResponse,
  AuthContext,
  DatasetFileType,
  S3Object,
} from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import {
  defaultTableName,
  deriveButtonMode,
  recomputeLocationForName,
  runAnalyze,
  type ButtonMode,
} from "./createTableActions";
import type { ResolveState } from "./FindingsPanel";

export interface CreateTableState {
  analyze: AnalyzeResponse | null;
  tableName: string;
  setTableName: (v: string) => void;
  state: ResolveState;
  setState: React.Dispatch<React.SetStateAction<ResolveState>>;
  analyzing: boolean;
  creating: boolean;
  setCreating: (b: boolean) => void;
  error: Error | null;
  setError: (e: Error | null) => void;
  effectiveLocation: AnalyzeResponse["location"] | null;
  buttonMode: ButtonMode;
  columnIndexByName: Record<string, number>;
}

export function useCreateTableState(
  provider: AuthProvider,
  context: AuthContext | null,
  file: S3Object,
  fileType: DatasetFileType
): CreateTableState {
  const [analyze, setAnalyze] = useState<AnalyzeResponse | null>(null);
  const [tableName, setTableName] = useState(() => defaultTableName(file.name));
  const [state, setState] = useState<ResolveState>(() => ({
    replaceExisting: false,
    stringOverrides: new Set<number>(),
    acceptedSerdeSwap: false,
    dismissedAdvisoryKeys: new Set<string>(),
  }));
  const [analyzing, setAnalyzing] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!context) return;
    return runAnalyze(
      provider,
      context,
      file,
      fileType,
      tableName,
      setAnalyze,
      setError,
      setAnalyzing
    );
    // Analyze once on mount; re-validate duplicate-table server-side on submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, context, file.key, fileType]);

  // When analyze lands, pre-apply STRING overrides for every type-mismatch
  // finding. Users arrive at a review modal where the obvious rots are
  // already resolved; they just confirm or "restore" if they disagree.
  useEffect(() => {
    if (!analyze) return;
    const auto = new Set<number>();
    for (const f of analyze.findings) {
      if (f.kind !== "type-mismatch") continue;
      const idx = analyze.columns.findIndex((c) => c.name === f.column);
      if (idx >= 0) auto.add(idx);
    }
    if (auto.size === 0) return;
    setState((prev) => {
      // Don't clobber user edits if they've already touched overrides.
      if (prev.stringOverrides.size > 0) return prev;
      return { ...prev, stringOverrides: auto };
    });
  }, [analyze]);

  const columnIndexByName = useMemo(() => {
    const map: Record<string, number> = {};
    (analyze?.columns ?? []).forEach((c, i) => (map[c.name] = i));
    return map;
  }, [analyze?.columns]);

  const effectiveLocation =
    analyze && context ? recomputeLocationForName(analyze, tableName, context) : null;
  const buttonMode = deriveButtonMode(analyze?.findings ?? [], state, columnIndexByName);

  return {
    analyze,
    tableName,
    setTableName,
    state,
    setState,
    analyzing,
    creating,
    setCreating,
    error,
    setError,
    effectiveLocation,
    buttonMode,
    columnIndexByName,
  };
}
