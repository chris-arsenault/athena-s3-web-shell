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
  { name: "analytics", description: "Product analytics" },
  { name: "marketing", description: "Campaign + attribution" },
];

const TABLES: Record<string, TableRef[]> = {
  default: [
    {
      name: "events",
      database: "default",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/events/",
    },
    {
      name: "users",
      database: "default",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/users/",
    },
  ],
  sales: [
    {
      name: "orders",
      database: "sales",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/orders/",
    },
    {
      name: "customers",
      database: "sales",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/customers/",
    },
    {
      name: "order_items",
      database: "sales",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/order_items/",
    },
    {
      name: "refunds",
      database: "sales",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/refunds/",
    },
  ],
  analytics: [
    {
      name: "page_views",
      database: "analytics",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/page_views/",
    },
    {
      name: "sessions",
      database: "analytics",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/sessions/",
    },
    {
      name: "experiments",
      database: "analytics",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/experiments/",
    },
  ],
  marketing: [
    {
      name: "campaigns",
      database: "marketing",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/campaigns/",
    },
    {
      name: "email_sends",
      database: "marketing",
      type: "EXTERNAL_TABLE",
      location: "s3://athena-shell-dev/datasets/email_sends/",
    },
    {
      name: "attribution",
      database: "marketing",
      type: "VIEW",
      location: "s3://athena-shell-dev/datasets/attribution/",
    },
  ],
};

/**
 * Look up any table in the mock catalog whose LOCATION matches the given
 * S3 URL. Used by mockDatasets.analyze to detect duplicate-table
 * findings in demo mode.
 */
export function findMockTableByLocation(location: string): TableRef | null {
  const normalized = location.endsWith("/") ? location : `${location}/`;
  for (const db of Object.keys(TABLES)) {
    for (const t of TABLES[db] ?? []) {
      if (!t.location) continue;
      const loc = t.location.endsWith("/") ? t.location : `${t.location}/`;
      if (loc === normalized) return t;
    }
  }
  return null;
}

/**
 * Drop a table from the mock catalog. Mirrors DROP TABLE in mock mode
 * so the "Replace existing table" flow has somewhere to land.
 */
export function dropMockTable(database: string, table: string): void {
  const bucket = TABLES[database];
  if (!bucket) return;
  const idx = bucket.findIndex((t) => t.name === table);
  if (idx >= 0) bucket.splice(idx, 1);
  delete TABLE_DETAILS[`${database}.${table}`];
}

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
      { name: "source", type: "string" },
      { name: "device", type: "string" },
      { name: "properties", type: "map<string,string>" },
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
      { name: "country", type: "string" },
      { name: "plan", type: "string" },
      { name: "created_at", type: "timestamp" },
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
      { name: "currency", type: "string" },
      { name: "status", type: "string" },
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
      { name: "email", type: "string" },
      { name: "country", type: "string" },
      { name: "segment", type: "string" },
      { name: "lifetime_value", type: "decimal(12,2)" },
    ],
    partitionKeys: [],
  },
  "sales.order_items": {
    name: "order_items",
    database: "sales",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "order_id", type: "bigint" },
      { name: "sku", type: "string" },
      { name: "quantity", type: "int" },
      { name: "unit_price", type: "decimal(10,2)" },
    ],
    partitionKeys: [],
  },
  "sales.refunds": {
    name: "refunds",
    database: "sales",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "refund_id", type: "bigint" },
      { name: "order_id", type: "bigint" },
      { name: "amount", type: "decimal(10,2)" },
      { name: "reason", type: "string" },
      { name: "refunded_at", type: "timestamp" },
    ],
    partitionKeys: [],
  },
  "analytics.page_views": {
    name: "page_views",
    database: "analytics",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "session_id", type: "string" },
      { name: "user_id", type: "string" },
      { name: "path", type: "string" },
      { name: "referrer", type: "string" },
      { name: "duration_ms", type: "int" },
      { name: "ts", type: "timestamp" },
    ],
    partitionKeys: [{ name: "dt", type: "string", partitionKey: true }],
  },
  "analytics.sessions": {
    name: "sessions",
    database: "analytics",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "session_id", type: "string" },
      { name: "user_id", type: "string" },
      { name: "started_at", type: "timestamp" },
      { name: "ended_at", type: "timestamp" },
      { name: "page_count", type: "int" },
      { name: "utm_source", type: "string" },
    ],
    partitionKeys: [],
  },
  "analytics.experiments": {
    name: "experiments",
    database: "analytics",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "experiment_id", type: "string" },
      { name: "variant", type: "string" },
      { name: "user_id", type: "string" },
      { name: "assigned_at", type: "timestamp" },
      { name: "converted", type: "boolean" },
    ],
    partitionKeys: [],
  },
  "marketing.campaigns": {
    name: "campaigns",
    database: "marketing",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "campaign_id", type: "string" },
      { name: "name", type: "string" },
      { name: "channel", type: "string" },
      { name: "budget_usd", type: "decimal(12,2)" },
      { name: "starts_on", type: "date" },
      { name: "ends_on", type: "date" },
    ],
    partitionKeys: [],
  },
  "marketing.email_sends": {
    name: "email_sends",
    database: "marketing",
    type: "EXTERNAL_TABLE",
    columns: [
      { name: "send_id", type: "string" },
      { name: "campaign_id", type: "string" },
      { name: "user_id", type: "string" },
      { name: "sent_at", type: "timestamp" },
      { name: "opened", type: "boolean" },
      { name: "clicked", type: "boolean" },
    ],
    partitionKeys: [],
  },
  "marketing.attribution": {
    name: "attribution",
    database: "marketing",
    type: "VIEW",
    columns: [
      { name: "user_id", type: "string" },
      { name: "first_touch_channel", type: "string" },
      { name: "last_touch_channel", type: "string" },
      { name: "first_order_id", type: "bigint" },
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

export async function mockSaveResult(
  executionId: string,
  opts: { targetKey: string; includeSqlSidecar: boolean; overwrite: boolean }
): Promise<{ key: string; sidecarKey?: string }> {
  const e = executions.get(executionId);
  if (!e) throw new Error(`No execution ${executionId}`);
  if (e.status.state !== "SUCCEEDED") {
    throw new Error(`execution ${executionId} not in SUCCEEDED state`);
  }
  const { mockS3 } = await import("./mockS3Store.js");
  if (!opts.overwrite && mockS3.exists(opts.targetKey)) {
    const err = new Error(`target already exists: ${opts.targetKey}`);
    (err as Error & { code: string }).code = "already_exists";
    throw err;
  }
  const csv = resultsToCsvBytes(e.results);
  const buf = csv.buffer.slice(csv.byteOffset, csv.byteOffset + csv.byteLength) as ArrayBuffer;
  await mockS3.put(opts.targetKey, buf, csv.byteLength);
  let sidecarKey: string | undefined;
  if (opts.includeSqlSidecar) {
    sidecarKey = swapExtension(opts.targetKey, ".sql");
    await mockS3.put(sidecarKey, e.status.sql, e.status.sql.length);
  }
  return { key: opts.targetKey, sidecarKey };
}

function resultsToCsvBytes(page: QueryResultPage): Uint8Array {
  const lines: string[] = [page.columns.map((c) => csvCell(c.name)).join(",")];
  for (const row of page.rows) lines.push(row.map(csvCell).join(","));
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function swapExtension(key: string, newExt: string): string {
  const idx = key.lastIndexOf(".");
  if (idx === -1) return key + newExt;
  return key.slice(0, idx) + newExt;
}

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
  async fetchAllResultsDirect(
    id: string,
    firstPage: QueryResultPage
  ): Promise<QueryResultPage> {
    const e = executions.get(id);
    if (!e) throw new Error(`No execution ${id}`);
    // Mock path mirrors the real path's contract: one-shot return of
    // the full result set, columns from the caller's first page.
    return {
      columns: firstPage.columns,
      rows: e.results.rows,
      nextToken: undefined,
    };
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
