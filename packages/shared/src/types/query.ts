export type QueryState =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface QueryRequest {
  sql: string;
  database?: string;
}

export interface QueryStats {
  dataScannedBytes?: number;
  engineExecutionMs?: number;
  totalExecutionMs?: number;
}

export interface QueryStatus {
  executionId: string;
  state: QueryState;
  stateChangeReason?: string;
  submittedAt: string;
  completedAt?: string;
  workgroup: string;
  database?: string;
  sql: string;
  stats?: QueryStats;
  outputLocation?: string;
}

export interface ResultColumn {
  name: string;
  type: string;
  label?: string;
}

export interface QueryResultPage {
  columns: ResultColumn[];
  rows: string[][];
  nextToken?: string;
}

export interface HistoryEntry {
  executionId: string;
  sql: string;
  state: QueryState;
  submittedAt: string;
  completedAt?: string;
  database?: string;
  workgroup: string;
  source: "athena" | "local";
  favorite?: boolean;
}

export interface HistoryPage {
  items: HistoryEntry[];
  nextToken?: string;
}
