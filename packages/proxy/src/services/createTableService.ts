import type { AthenaClient } from "@aws-sdk/client-athena";

import type {
  AthenaScope,
  CreateTableRequest,
  CreateTableResponse,
  TableCreatePlan,
} from "@athena-shell/shared";

import { createDatabaseDdl, ddlForPlan, ddlForRequest } from "./ddlTemplates.js";
import { getQuery, startQuery } from "./queryService.js";

const DDL_POLL_INTERVAL_MS = 400;
const DDL_POLL_TIMEOUT_MS = 60_000;
const ENSURE_DB_POLL_INTERVAL_MS = 400;
const ENSURE_DB_POLL_TIMEOUT_MS = 30_000;

export async function createTable(
  athena: AthenaClient,
  scope: AthenaScope,
  request: CreateTableRequest
): Promise<CreateTableResponse> {
  await ensureDatabase(athena, scope, request.database);
  const sql = ddlForRequest(request);
  const { executionId } = await startQuery(athena, scope, { sql });
  return { executionId, database: request.database, table: request.table };
}

/**
 * Execute a resolved TableCreatePlan. Runs (in order):
 *   - ensureDatabase (idempotent)
 *   - DROP VIEW / DROP TABLE   (when replaceExisting=true)
 *   - CREATE TABLE             (on raw_<name> if STRING overrides, else <name>)
 *   - CREATE OR REPLACE VIEW   (when STRING overrides were applied)
 *
 * Each statement is its own Athena StartQueryExecution; we await the
 * preceding one before firing the next. Returns the final execution id
 * (usually the view, else the table).
 */
export async function createTableFromPlan(
  athena: AthenaClient,
  scope: AthenaScope,
  plan: TableCreatePlan
): Promise<CreateTableResponse> {
  if (plan.location.strategy === "blocked") {
    throw new Error("plan has a blocked location strategy — cannot create table");
  }
  if (!plan.location.finalLocation) {
    throw new Error("plan has no finalLocation");
  }

  await ensureDatabase(athena, scope, plan.database);

  const { statements, rawTable, viewName } = ddlForPlan(plan);
  let lastExecutionId = "";
  for (const sql of statements) {
    const { executionId } = await startQuery(athena, scope, { sql });
    await waitForQuery(athena, executionId, sql);
    lastExecutionId = executionId;
  }
  return {
    executionId: lastExecutionId,
    database: plan.database,
    table: viewName ?? rawTable,
    ...(viewName ? { view: viewName } : {}),
  };
}

async function ensureDatabase(
  athena: AthenaClient,
  scope: AthenaScope,
  database: string
): Promise<void> {
  const { executionId } = await startQuery(athena, scope, {
    sql: createDatabaseDdl(database),
  });
  const start = Date.now();
  for (;;) {
    const status = await getQuery(athena, executionId);
    if (status.state === "SUCCEEDED") return;
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(
        `CREATE DATABASE failed: ${status.stateChangeReason ?? status.state}`
      );
    }
    if (Date.now() - start > ENSURE_DB_POLL_TIMEOUT_MS) {
      throw new Error("Timed out waiting for CREATE DATABASE to finish");
    }
    await new Promise((r) => setTimeout(r, ENSURE_DB_POLL_INTERVAL_MS));
  }
}

async function waitForQuery(
  athena: AthenaClient,
  executionId: string,
  sqlForError: string
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const status = await getQuery(athena, executionId);
    if (status.state === "SUCCEEDED") return;
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      throw new Error(
        `DDL failed (${status.state}): ${status.stateChangeReason ?? "unknown"} — ${truncate(sqlForError)}`
      );
    }
    if (Date.now() - start > DDL_POLL_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for DDL: ${truncate(sqlForError)}`);
    }
    await new Promise((r) => setTimeout(r, DDL_POLL_INTERVAL_MS));
  }
}

function truncate(s: string): string {
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}
