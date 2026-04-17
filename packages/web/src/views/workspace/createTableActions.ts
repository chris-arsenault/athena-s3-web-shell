import {
  QUERY_POLL_INTERVAL_MS,
  type AnalyzeResponse,
  type AuthContext,
  type DatasetFileType,
  type Finding,
  type S3Object,
  type TableCreatePlan,
} from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { analyzeDataset, createTableFromPlan } from "../../data/datasetsRepo";
import { getQuery } from "../../data/queryRepo";
import { copyObject, deleteObject } from "../../data/s3Repo";
import type { useSchema } from "../../data/schemaContext";
import {
  hasUnresolvedAdvisory,
  hasUnresolvedBlock,
  type ResolveState,
} from "./FindingsPanel";

export type ButtonMode = "clean" | "advisory" | "blocked";

export function deriveButtonMode(
  findings: Finding[],
  state: ResolveState,
  columnIndexByName: Record<string, number>
): ButtonMode {
  if (hasUnresolvedBlock(findings, state)) return "blocked";
  if (hasUnresolvedAdvisory(findings, state, columnIndexByName)) return "advisory";
  return "clean";
}

export function toggleOverride(
  setState: (updater: (s: ResolveState) => ResolveState) => void,
  idx: number,
  add: boolean = false
): void {
  setState((s) => {
    const next = new Set(s.stringOverrides);
    if (add) next.add(idx);
    else if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    return { ...s, stringOverrides: next };
  });
}

/**
 * OpenCSVSerde can only store STRING values natively — its DATE/TIMESTAMP
 * types require UNIX numeric form, and INT/DOUBLE columns CAST to their
 * declared type at query time. So when the user accepts the SerDe swap,
 * force all non-string (non-boolean) columns to STRING and let the
 * companion view restore the typed surface via TRY_CAST.
 */
export function narrowColumnIndices(
  columns: ReadonlyArray<{ type: string }>
): Set<number> {
  const out = new Set<number>();
  columns.forEach((col, i) => {
    const base = col.type.toLowerCase().replace(/\(.*/, "").trim();
    if (base !== "string" && base !== "boolean") out.add(i);
  });
  return out;
}

export function defaultTableName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const cleaned = stem.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) return "dataset";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function sanitizeDirSlug(raw: string): string {
  const slug = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!slug) return "dataset";
  return /^[0-9]/.test(slug) ? `_${slug}` : slug;
}

export function recomputeLocationForName(
  analyze: AnalyzeResponse,
  tableName: string,
  context: AuthContext
): AnalyzeResponse["location"] {
  if (analyze.location.strategy !== "move") return analyze.location;
  const slug = sanitizeDirSlug(tableName);
  const finalLocation = `s3://${context.s3.bucket}/${context.s3.prefix}datasets/${slug}/`;
  return {
    ...analyze.location,
    finalLocation,
    summary: `Move source into datasets/${slug}/`,
  };
}

/**
 * When the user accepts "replace existing" on a duplicate-table block,
 * the plan that actually gets sent to the proxy is what we would have
 * emitted if the duplicate didn't exist. Re-derives strategy (in-place
 * vs move) from the source key and table name.
 */
export function unblockForReplace(
  source: { key: string },
  tableName: string,
  context: AuthContext
): AnalyzeResponse["location"] {
  const datasetsPrefix = `${context.s3.prefix}datasets/`;
  const isInsideSubdir =
    source.key.startsWith(datasetsPrefix) &&
    source.key.slice(datasetsPrefix.length).includes("/");
  if (isInsideSubdir) {
    const parentDir = source.key.slice(0, source.key.lastIndexOf("/") + 1);
    return {
      strategy: "in-place",
      finalLocation: `s3://${context.s3.bucket}/${parentDir}`,
      summary: "Register in place (replacing existing table)",
    };
  }
  const slug = sanitizeDirSlug(tableName);
  return {
    strategy: "move",
    finalLocation: `s3://${context.s3.bucket}/${datasetsPrefix}${slug}/`,
    summary: `Move source into datasets/${slug}/ (replacing existing table)`,
  };
}

export function finalLocationToObjectKey(finalLocation: string, fileName: string): string {
  const m = /^s3:\/\/[^/]+\/(.+?)\/?$/.exec(finalLocation);
  if (!m) throw new Error(`invalid finalLocation: ${finalLocation}`);
  const dirKey = m[1]!;
  return `${dirKey.endsWith("/") ? dirKey : dirKey + "/"}${fileName}`;
}

// ---------------------------------------------------------------------------

export function runAnalyze(
  provider: AuthProvider,
  context: AuthContext,
  file: S3Object,
  fileType: DatasetFileType,
  tableName: string,
  setAnalyze: (a: AnalyzeResponse) => void,
  setError: (e: Error | null) => void,
  setAnalyzing: (b: boolean) => void
): () => void {
  let cancelled = false;
  (async () => {
    try {
      const response = await analyzeDataset(provider, {
        bucket: context.s3.bucket,
        key: file.key,
        fileType,
        table: tableName,
        sizeBytes: file.size,
      });
      if (cancelled) return;
      setAnalyze(response);
    } catch (e) {
      if (!cancelled) setError(e as Error);
    } finally {
      if (!cancelled) setAnalyzing(false);
    }
  })();
  return () => {
    cancelled = true;
  };
}

export interface RunCreateArgs {
  provider: AuthProvider;
  context: AuthContext;
  file: S3Object;
  analyze: AnalyzeResponse;
  location: AnalyzeResponse["location"];
  tableName: string;
  state: ResolveState;
  database: string;
  fileType: DatasetFileType;
  schema: ReturnType<typeof useSchema>;
  setCreating: (b: boolean) => void;
  setError: (e: Error | null) => void;
  onCreated: () => void;
}

export async function runCreate(args: RunCreateArgs): Promise<void> {
  const {
    provider,
    context,
    file,
    analyze,
    location,
    tableName,
    state,
    database,
    fileType,
    schema,
    setCreating,
    setError,
    onCreated,
  } = args;
  setError(null);
  setCreating(true);
  try {
    // When "replace existing" is checked, the reported blocked plan
    // becomes whatever the plan would have been without the duplicate —
    // proxy needs a valid strategy to emit DDL.
    const effective =
      state.replaceExisting && location.strategy === "blocked"
        ? unblockForReplace(file, tableName, context)
        : location;
    if (effective.strategy === "move") {
      if (!effective.finalLocation) throw new Error("move plan missing finalLocation");
      const targetKey = finalLocationToObjectKey(effective.finalLocation, file.name);
      if (file.key !== targetKey) {
        await copyObject(provider, context, file.key, targetKey);
        await deleteObject(provider, context, file.key);
      }
    }
    const plan: TableCreatePlan = {
      database,
      table: tableName,
      fileType,
      columns: analyze.columns,
      stringOverrides: [...state.stringOverrides].sort((a, b) => a - b),
      location: effective,
      skipHeader: analyze.hasHeader,
      csvSerde: resolveSerde(state),
      nullFormat: state.acceptedNullFormat,
      replaceExisting: state.replaceExisting,
    };
    const response = await createTableFromPlan(provider, plan);
    if (response.executionId) await pollDdl(provider, response.executionId);
    await schema.refresh();
    onCreated();
  } catch (e) {
    setError(e as Error);
  } finally {
    setCreating(false);
  }
}

function resolveSerde(state: ResolveState): TableCreatePlan["csvSerde"] {
  if (state.acceptedSerdeSwap) return "OpenCSVSerde";
  if (state.acceptedNullFormat !== undefined) return "LazySimpleSerDe";
  return undefined;
}

async function pollDdl(provider: AuthProvider, executionId: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const status = await getQuery(provider, executionId);
    if (status.state === "SUCCEEDED") return;
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(status.stateChangeReason ?? `Table creation ${status.state}`);
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for table creation");
    }
    await new Promise((r) => setTimeout(r, QUERY_POLL_INTERVAL_MS));
  }
}
