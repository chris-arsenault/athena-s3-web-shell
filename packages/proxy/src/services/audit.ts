import { createHash } from "node:crypto";
import type { Request } from "express";
import { pino, type Logger } from "pino";

/**
 * Audit logging.
 *
 * pino child logger, `{ kind: "audit", service: "athena-shell-proxy" }`,
 * JSON one-line-per-event to stdout. ECS's awslogs driver picks it up
 * into the proxy's CloudWatch log group alongside the HTTP access log.
 * Reviewers filter by `{ $.kind = "audit" }` in Logs Insights.
 *
 * SQL is NEVER logged literally — it's normalized (string + number
 * literals collapsed to placeholders, comments stripped) and hashed.
 * The fingerprint is safe to ship to reviewers; the hash is a stable
 * identity for correlating identical shapes across users.
 *
 * See docs/audit-schema.md for the full event dictionary.
 */

const baseLogger: Logger = pino({
  level: process.env.AUDIT_LOG_LEVEL ?? "info",
  base: { service: "athena-shell-proxy" },
  formatters: { level: (label) => ({ level: label }) },
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
});

const logger = baseLogger.child({ kind: "audit" });

// In-memory dedup for query.end — a SUCCEEDED/FAILED/CANCELLED state
// often lands on a poll that the SPA hits repeatedly. We emit exactly
// once per executionId, per proxy process. Bounded to keep memory flat;
// on proxy restart the set empties, which is acceptable — a missing
// query.end event after a container restart is not a compliance loss
// (the authoritative data lives in Athena's own query history).
const emittedEnds = new Set<string>();
const EMIT_END_CAP = 10_000;

// ---------------------------------------------------------------------------
// Envelope helpers

interface Envelope {
  event: string;
  ts?: string; // pino timestamp formatter supplies this
  requestId: string;
  sourceIp: string | null;
  user: { id: string; name: string; email: string } | null;
}

function envelope(req: Request, event: string): Envelope {
  const u = req.user;
  return {
    event,
    requestId: req.requestId ?? "-",
    sourceIp: sourceIpOf(req),
    user: u
      ? { id: u.userId, name: u.displayName, email: u.email }
      : null,
  };
}

function sourceIpOf(req: Request): string | null {
  // With `app.set('trust proxy', true)` Express resolves req.ip from
  // X-Forwarded-For. Fall back to the raw connection IP for tests +
  // non-ALB paths.
  return req.ip ?? null;
}

// ---------------------------------------------------------------------------
// SQL fingerprinting

/**
 * Produces a redaction-safe representation of a SQL statement + a short
 * hash of the normalized form. String and numeric literals collapse to
 * placeholders; line + block comments are stripped (comments can
 * inadvertently contain PII / credentials).
 */
export function sqlFingerprint(sql: string): { sqlFingerprint: string; sqlHash: string } {
  let norm = sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "'?'")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim();
  const FINGERPRINT_CAP = 4096;
  if (norm.length > FINGERPRINT_CAP) {
    norm = `${norm.slice(0, FINGERPRINT_CAP)}…`;
  }
  const sqlHash = createHash("sha256").update(norm).digest("hex").slice(0, 16);
  return { sqlFingerprint: norm, sqlHash };
}

// ---------------------------------------------------------------------------
// Typed event emitters — one per route-level operation

interface QueryStartAttrs {
  sql: string;
  database?: string;
  workgroup: string;
  executionId: string;
}

function queryStart(req: Request, attrs: QueryStartAttrs): void {
  logger.info({
    ...envelope(req, "query.start"),
    ...sqlFingerprint(attrs.sql),
    database: attrs.database,
    workgroup: attrs.workgroup,
    executionId: attrs.executionId,
    outcome: "ok",
  });
}

interface QueryEndAttrs {
  executionId: string;
  state: string;
  stateChangeReason?: string;
  dataScannedBytes?: number;
  totalExecutionMs?: number;
  completedAt?: string;
}

function queryEnd(req: Request, attrs: QueryEndAttrs): void {
  if (emittedEnds.has(attrs.executionId)) return;
  if (emittedEnds.size >= EMIT_END_CAP) emittedEnds.clear();
  emittedEnds.add(attrs.executionId);
  logger.info({
    ...envelope(req, "query.end"),
    executionId: attrs.executionId,
    state: attrs.state,
    dataScannedBytes: attrs.dataScannedBytes,
    totalExecutionMs: attrs.totalExecutionMs,
    completedAt: attrs.completedAt,
    outcome: attrs.state === "SUCCEEDED" ? "ok" : "error",
    errorMessage: attrs.state === "SUCCEEDED" ? undefined : attrs.stateChangeReason,
  });
}

function queryStop(req: Request, attrs: { executionId: string }): void {
  logger.info({
    ...envelope(req, "query.stop"),
    executionId: attrs.executionId,
    outcome: "ok",
  });
}

function queryResults(
  req: Request,
  attrs: { executionId: string; rowCount: number; hasMore: boolean }
): void {
  logger.info({
    ...envelope(req, "query.results"),
    executionId: attrs.executionId,
    rowCount: attrs.rowCount,
    hasMore: attrs.hasMore,
    outcome: "ok",
  });
}

function queryDownload(
  req: Request,
  attrs: { executionId: string; outputLocation: string }
): void {
  logger.info({
    ...envelope(req, "query.download"),
    executionId: attrs.executionId,
    outputLocation: attrs.outputLocation,
    outcome: "ok",
  });
}

function datasetsInfer(
  req: Request,
  attrs: { bucket: string; key: string; fileType: string }
): void {
  logger.info({
    ...envelope(req, "datasets.infer"),
    bucket: attrs.bucket,
    key: attrs.key,
    fileType: attrs.fileType,
    outcome: "ok",
  });
}

function datasetsCreateTable(
  req: Request,
  attrs: {
    database: string;
    table: string;
    location: string;
    fileType: string;
    executionId: string;
  }
): void {
  logger.info({
    ...envelope(req, "datasets.create_table"),
    database: attrs.database,
    table: attrs.table,
    location: attrs.location,
    fileType: attrs.fileType,
    executionId: attrs.executionId,
    outcome: "ok",
  });
}

function querySaveToWorkspace(
  req: Request,
  attrs: {
    executionId: string;
    targetKey: string;
    includeSqlSidecar: boolean;
  }
): void {
  logger.info({
    ...envelope(req, "query.save_to_workspace"),
    executionId: attrs.executionId,
    targetKey: attrs.targetKey,
    includeSqlSidecar: attrs.includeSqlSidecar,
    outcome: "ok",
  });
}

export const audit = {
  queryStart,
  queryEnd,
  queryStop,
  queryResults,
  queryDownload,
  querySaveToWorkspace,
  datasetsInfer,
  datasetsCreateTable,
};
