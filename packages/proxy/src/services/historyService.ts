import {
  type AthenaClient,
  BatchGetQueryExecutionCommand,
  ListQueryExecutionsCommand,
} from "@aws-sdk/client-athena";

import type { HistoryEntry, HistoryPage } from "@athena-shell/shared";

import { getQuery } from "./queryService.js";

const BATCH_LIMIT = 50;

export async function listHistory(
  client: AthenaClient,
  workgroup: string,
  pageSize: number,
  nextToken?: string
): Promise<HistoryPage> {
  const list = await client.send(
    new ListQueryExecutionsCommand({
      WorkGroup: workgroup,
      MaxResults: pageSize,
      NextToken: nextToken,
    })
  );
  const ids = list.QueryExecutionIds ?? [];
  if (ids.length === 0) return { items: [], nextToken: list.NextToken };

  const items: HistoryEntry[] = [];
  for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
    const slice = ids.slice(i, i + BATCH_LIMIT);
    const batch = await client.send(
      new BatchGetQueryExecutionCommand({ QueryExecutionIds: slice })
    );
    for (const id of slice) {
      const e = batch.QueryExecutions?.find((q) => q.QueryExecutionId === id);
      if (!e) continue;
      const status = await mapExecutionToEntry(e);
      items.push(status);
    }
  }
  return { items, nextToken: list.NextToken };
}

const TERMINAL_STATES: ReadonlySet<HistoryEntry["state"]> = new Set([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

async function mapExecutionToEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  e: any
): Promise<HistoryEntry> {
  const status = e.Status ?? {};
  return {
    executionId: e.QueryExecutionId ?? "",
    sql: e.Query ?? "",
    state: mapState(status.State),
    submittedAt: status.SubmissionDateTime?.toISOString() ?? new Date().toISOString(),
    completedAt: status.CompletionDateTime?.toISOString(),
    database: e.QueryExecutionContext?.Database,
    workgroup: e.WorkGroup ?? "",
    source: "athena",
  };
}

function mapState(s: string | undefined): HistoryEntry["state"] {
  return TERMINAL_STATES.has(s as HistoryEntry["state"])
    ? (s as HistoryEntry["state"])
    : "QUEUED";
}

export const _getQuery = getQuery;
