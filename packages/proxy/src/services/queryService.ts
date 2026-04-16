import {
  type AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
  StopQueryExecutionCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena";

import type {
  AthenaScope,
  QueryRequest,
  QueryResultPage,
  QueryStatus,
  ResultColumn,
} from "@athena-shell/shared";

export async function startQuery(
  client: AthenaClient,
  scope: AthenaScope,
  req: QueryRequest
): Promise<{ executionId: string }> {
  const out = await client.send(
    new StartQueryExecutionCommand({
      QueryString: req.sql,
      WorkGroup: scope.workgroup,
      ResultConfiguration: { OutputLocation: scope.outputLocation },
      QueryExecutionContext: req.database
        ? { Database: req.database }
        : scope.defaultDatabase
          ? { Database: scope.defaultDatabase }
          : undefined,
    })
  );
  if (!out.QueryExecutionId) throw new Error("Athena did not return a query id");
  return { executionId: out.QueryExecutionId };
}

export async function getQuery(
  client: AthenaClient,
  executionId: string
): Promise<QueryStatus> {
  const out = await client.send(
    new GetQueryExecutionCommand({ QueryExecutionId: executionId })
  );
  const e = out.QueryExecution;
  if (!e) throw new Error(`No query execution found for ${executionId}`);
  return executionToStatus(executionId, e);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function executionToStatus(executionId: string, e: any): QueryStatus {
  const status = e.Status ?? {};
  const stats = e.Statistics ?? {};
  return {
    executionId,
    state: mapState(status.State),
    stateChangeReason: status.StateChangeReason,
    submittedAt: status.SubmissionDateTime?.toISOString() ?? new Date().toISOString(),
    completedAt: status.CompletionDateTime?.toISOString(),
    workgroup: e.WorkGroup ?? "",
    database: e.QueryExecutionContext?.Database,
    sql: e.Query ?? "",
    stats: {
      dataScannedBytes: stats.DataScannedInBytes,
      engineExecutionMs: stats.EngineExecutionTimeInMillis,
      totalExecutionMs: stats.TotalExecutionTimeInMillis,
    },
    outputLocation: e.ResultConfiguration?.OutputLocation,
  };
}

export async function stopQuery(
  client: AthenaClient,
  executionId: string
): Promise<void> {
  await client.send(new StopQueryExecutionCommand({ QueryExecutionId: executionId }));
}

export async function getResults(
  client: AthenaClient,
  executionId: string,
  nextToken?: string,
  maxResults?: number
): Promise<QueryResultPage> {
  const out = await client.send(
    new GetQueryResultsCommand({
      QueryExecutionId: executionId,
      NextToken: nextToken,
      MaxResults: maxResults,
    })
  );
  const meta = out.ResultSet?.ResultSetMetadata?.ColumnInfo ?? [];
  const columns: ResultColumn[] = meta.map((c) => ({
    name: c.Name ?? "",
    type: c.Type ?? "string",
    label: c.Label,
  }));
  const rawRows = out.ResultSet?.Rows ?? [];
  const dataRows = nextToken ? rawRows : rawRows.slice(1);
  const rows = dataRows.map(
    (row) => row.Data?.map((cell) => cell.VarCharValue ?? "") ?? []
  );
  return { columns, rows, nextToken: out.NextToken };
}

function mapState(s: QueryExecutionState | undefined): QueryStatus["state"] {
  switch (s) {
    case "QUEUED":
      return "QUEUED";
    case "RUNNING":
      return "RUNNING";
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "QUEUED";
  }
}
