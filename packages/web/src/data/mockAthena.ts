import type {
  DatabaseRef,
  HistoryEntry,
  Page,
  QueryResultPage,
  QueryStatus,
  TableDetail,
  TableRef,
} from "@athena-shell/shared";

const DATABASES: DatabaseRef[] = [
  { name: "default", description: "Default database" },
  { name: "sales", description: "Sales data" },
];

const TABLES: Record<string, TableRef[]> = {
  default: [
    { name: "events", database: "default", type: "EXTERNAL_TABLE" },
    { name: "users", database: "default", type: "EXTERNAL_TABLE" },
  ],
  sales: [
    { name: "orders", database: "sales", type: "EXTERNAL_TABLE" },
    { name: "customers", database: "sales", type: "EXTERNAL_TABLE" },
  ],
};

const TABLE_DETAILS: Record<string, TableDetail> = {
  "default.events": {
    name: "events",
    database: "default",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "event_id", type: "string" },
      { name: "user_id", type: "string" },
      { name: "event_type", type: "string" },
      { name: "ts", type: "timestamp" },
    ],
    partitionKeys: [{ name: "dt", type: "string", partitionKey: true }],
    location: "s3://athena-shell-dev/datasets/events/",
  },
  "default.users": {
    name: "users",
    database: "default",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "id", type: "bigint" },
      { name: "name", type: "string" },
      { name: "email", type: "string" },
    ],
    partitionKeys: [],
    location: "s3://athena-shell-dev/datasets/users/",
  },
  "sales.orders": {
    name: "orders",
    database: "sales",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "order_id", type: "bigint" },
      { name: "customer_id", type: "bigint" },
      { name: "amount", type: "decimal(10,2)" },
      { name: "order_date", type: "date" },
    ],
    partitionKeys: [],
  },
  "sales.customers": {
    name: "customers",
    database: "sales",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "customer_id", type: "bigint" },
      { name: "name", type: "string" },
      { name: "country", type: "string" },
    ],
    partitionKeys: [],
  },
};

interface MockExecution {
  status: QueryStatus;
  results: QueryResultPage;
  startedAt: number;
}

const executions = new Map<string, MockExecution>();

function mockResultsFor(sql: string): QueryResultPage {
  const lower = sql.toLowerCase();
  if (lower.includes("count(")) {
    return {
      columns: [{ name: "count", type: "bigint" }],
      rows: [["1234"]],
    };
  }
  return {
    columns: [
      { name: "id", type: "bigint" },
      { name: "name", type: "string" },
      { name: "amount", type: "decimal(10,2)" },
    ],
    rows: [
      ["1", "Widget", "12.50"],
      ["2", "Gadget", "8.00"],
      ["3", "Sprocket", "42.00"],
    ],
  };
}

export const mockAthena = {
  async listDatabases(): Promise<Page<DatabaseRef>> {
    return { items: DATABASES };
  },
  async listTables(db: string): Promise<Page<TableRef>> {
    return { items: TABLES[db] ?? [] };
  },
  async getTable(db: string, table: string): Promise<TableDetail> {
    const key = `${db}.${table}`;
    const detail = TABLE_DETAILS[key];
    if (!detail) throw new Error(`No such table ${key}`);
    return detail;
  },
  async startQuery(sql: string, database?: string): Promise<{ executionId: string }> {
    const id = `mock-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    executions.set(id, {
      status: {
        executionId: id,
        state: "QUEUED",
        submittedAt: now,
        workgroup: "primary",
        database,
        sql,
        outputLocation: `s3://athena-shell-dev/_athena/dev/${id}.csv`,
      },
      results: mockResultsFor(sql),
      startedAt: Date.now(),
    });
    return { executionId: id };
  },
  async getQuery(id: string): Promise<QueryStatus> {
    const e = executions.get(id);
    if (!e) throw new Error(`No execution ${id}`);
    const elapsed = Date.now() - e.startedAt;
    const next: QueryStatus = { ...e.status };
    if (elapsed < 400) next.state = "QUEUED";
    else if (elapsed < 1200) next.state = "RUNNING";
    else {
      next.state = "SUCCEEDED";
      next.completedAt = next.completedAt ?? new Date().toISOString();
      next.stats = { dataScannedBytes: 1024, totalExecutionMs: elapsed };
    }
    e.status = next;
    return next;
  },
  async stopQuery(id: string): Promise<void> {
    const e = executions.get(id);
    if (!e) return;
    e.status = { ...e.status, state: "CANCELLED", completedAt: new Date().toISOString() };
  },
  async getResults(id: string): Promise<QueryResultPage> {
    const e = executions.get(id);
    if (!e) throw new Error(`No execution ${id}`);
    return e.results;
  },
  async listHistory(): Promise<{ items: HistoryEntry[]; nextToken?: string }> {
    const items: HistoryEntry[] = [];
    for (const e of executions.values()) {
      items.push({
        executionId: e.status.executionId,
        sql: e.status.sql,
        state: e.status.state,
        submittedAt: e.status.submittedAt,
        completedAt: e.status.completedAt,
        database: e.status.database,
        workgroup: e.status.workgroup,
        source: "athena",
      });
    }
    items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    return { items };
  },
};
