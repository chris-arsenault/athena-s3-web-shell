import type {
  DatabaseRef,
  HistoryEntry,
  Page,
  QueryResultPage,
  QueryStatus,
  TableDetail,
  TableRef,
} from "@athena-shell/shared";

// In-memory mutable catalog so table-creation flows (issue #5) appear in
// the schema tree under MOCK_AUTH=1. Tables added via `registerMockTable`
// go under a new workspace_* database on first use.
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

/**
 * Adds a user-created table to the mock catalog AND seeds an execution
 * record for the DDL so the SPA's polling loop sees a SUCCEEDED state.
 */
export function registerMockTable(
  ref: TableRef,
  detail: TableDetail,
  executionId: string
): void {
  if (!DATABASES.some((d) => d.name === ref.database)) {
    DATABASES.push({ name: ref.database, description: "User workspace" });
  }
  const bucket = TABLES[ref.database] ?? (TABLES[ref.database] = []);
  const existing = bucket.findIndex((t) => t.name === ref.name);
  if (existing >= 0) bucket[existing] = ref;
  else bucket.push(ref);
  TABLE_DETAILS[`${ref.database}.${ref.name}`] = detail;

  const now = new Date().toISOString();
  executions.set(executionId, {
    status: {
      executionId,
      state: "SUCCEEDED",
      submittedAt: now,
      completedAt: now,
      workgroup: "primary",
      database: ref.database,
      sql: `CREATE EXTERNAL TABLE ${ref.database}.${ref.name} (...)`,
      stats: { dataScannedBytes: 0, totalExecutionMs: 50 },
    },
    results: { columns: [], rows: [] },
    startedAt: Date.now() - 2000, // pre-aged so it registers as SUCCEEDED
  });
}

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

// 300 rows of demo data so virtualization + pagination have something to bite
// on in mock mode.
const LARGE_RESULT_ROW_COUNT = 300;
const MOCK_PAGE_SIZE = 100;
const PRODUCTS = [
  "Widget",
  "Gadget",
  "Sprocket",
  "Cog",
  "Piston",
  "Flange",
  "Bearing",
  "Coupler",
  "Manifold",
  "Valve",
];

function buildLargeRows(): string[][] {
  const rows: string[][] = [];
  for (let i = 1; i <= LARGE_RESULT_ROW_COUNT; i++) {
    rows.push([
      String(i),
      `${PRODUCTS[i % PRODUCTS.length]}-${String(i).padStart(4, "0")}`,
      (((i * 37) % 9991) / 7).toFixed(2),
      new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(),
    ]);
  }
  return rows;
}

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
      { name: "order_date", type: "timestamp" },
    ],
    rows: buildLargeRows(),
  };
}

// Mock pagination: returns MOCK_PAGE_SIZE rows per call. nextToken encodes
// the next start offset. Stops when we've exhausted the row set.
function paginate(
  page: QueryResultPage,
  nextToken?: string
): QueryResultPage {
  const offset = nextToken ? Number.parseInt(nextToken, 10) : 0;
  const end = offset + MOCK_PAGE_SIZE;
  const rows = page.rows.slice(offset, end);
  const more = end < page.rows.length;
  return {
    columns: page.columns,
    rows,
    nextToken: more ? String(end) : undefined,
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
  async getResults(id: string, nextToken?: string): Promise<QueryResultPage> {
    const e = executions.get(id);
    if (!e) throw new Error(`No execution ${id}`);
    return paginate(e.results, nextToken);
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
