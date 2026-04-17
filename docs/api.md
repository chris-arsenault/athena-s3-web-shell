# API + data layer

How the SPA talks to the proxy, how the proxy talks to AWS, and where the seams are.

## The data chokepoint

`packages/web/src/data/api.ts` is **the only place the SPA calls `fetch`** (enforced by `local/no-direct-fetch`). It exports `apiGet` / `apiPost` / `apiDelete`, which:

- Attach `authHeader` (mock cookie-style header in dev, `Authorization: Bearer` in deployed) and `awsCredentials` (three `x-aws-*` headers) via `data/proxyHeaders.ts`
- Build URLs from `API_BASE` + path + query params
- Parse JSON, throw `ApiError` with status + parsed payload on non-2xx

This is the seam where future cross-cutting concerns (request IDs, retries, telemetry) plug in.

## Proxy endpoints

All proxy routes are under `/api`. All require auth (mock or bearer) except `/health`.

| Endpoint | AWS call |
|---|---|
| `GET /api/health` | — |
| `GET /api/session` | returns `AuthContext` |
| `GET /api/schema/databases` | Glue `GetDatabases` |
| `GET /api/schema/databases/:db/tables` | Glue `GetTables` |
| `GET /api/schema/databases/:db/tables/:t` | Glue `GetTable` |
| `POST /api/query` | Athena `StartQueryExecution` |
| `GET /api/query/:id` | Athena `GetQueryExecution` |
| `DELETE /api/query/:id` | Athena `StopQueryExecution` |
| `GET /api/query/:id/results` | Athena `GetQueryResults` (paginated) |
| `GET /api/query/:id/download` | S3 presign on the Athena results CSV |
| `GET /api/query/:id/results-url` | S3 presign used by `load more` fast-path |
| `POST /api/query/:id/save-to-workspace` | S3 `CopyObject` results → user prefix |
| `GET /api/history` | Athena `ListQueryExecutions` + `BatchGetQueryExecution` |
| `POST /api/datasets/infer` | S3 range-fetch + in-proc schema inference |
| `POST /api/datasets/analyze` | inferSchema + location analysis + findings |
| `POST /api/datasets/create-table` | Athena DDL (CREATE TABLE + optional VIEW) |
| `POST /api/saved-queries` | Athena `CreateNamedQuery` |
| `GET /api/saved-queries` | Athena `ListNamedQueries` + `BatchGetNamedQuery` |
| `DELETE /api/saved-queries/:id` | Athena `DeleteNamedQuery` |

**S3 file operations (list / upload / download / delete / mkdir / copy) are browser-direct** via AWS SDK v3. They don't touch the proxy — multi-GB transfers stay off the task's memory.

## Repos: one per resource

Each domain has a repo in `packages/web/src/data/` that branches on `provider.isMock()`:

| Repo | Real path | Mock path |
|---|---|---|
| `s3Repo` | `S3Client` direct from browser with per-user STS creds | `mockS3Store` (seeded sample CSVs) |
| `queryRepo` | `apiGet`/`apiPost` to proxy | `mockAthena` (query lifecycle sim) |
| `schemaRepo` | proxy → Glue | `mockAthena` catalog |
| `historyRepo` | proxy `/history` + `localDb.favorites` merge | `mockAthena` + `localDb.favorites` |
| `savedQueriesRepo` | proxy → Athena NamedQuery | `mockSavedQueries` |
| `datasetsRepo` | proxy → `analyze` / `create-table` | `mockDatasets` |
| `scratchpadRepo` | `s3Repo` + a fixed `.scratchpad/` subprefix | `mockS3Store` |
| `localDb` | `idb` over IndexedDB | same — local only |

Branch shape is always `if (provider.isMock()) return mockX(...); else return apiCall(...);`. No strategy registry.

### Schema cache

`schemaRepo` is wrapped by a React context in `data/schemaContext.tsx` (`SchemaProvider` + `useSchema()`). Holds a single cache of `{ databases, tablesByDb, columnsByTable }` for a session. Both `SchemaTree` (sidebar) and the Monaco completion provider read from it. Databases + all tables load eagerly on mount; columns load lazily on first reference (tree expand or `table.` autocomplete).

**Don't call `schemaRepo` directly from anywhere inside QueryView** or you'll fork the cache.

## IndexedDB schema

`localDb.ts` — database `athena-shell` v2:

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `favorites` | autoincrement | `executionId` (unique) | Starred query history entries |
| `tabs` | `id` | `order` | Multi-tab SQL editor persistence (SQL + browser kinds) |
| `session` | `key` | — | Per-session scratchpad (active tab id, workspace prefix, etc.) |

`historyRepo.list()` merges Athena's `ListQueryExecutions` page with local favorites. Favorites tagged `source: "local"` show up even when the underlying execution has aged out of Athena's 45-day retention.

## Request flows worth knowing

### Query lifecycle

```
User clicks Run →
  queryRepo.startQuery → POST /api/query → Athena.StartQueryExecution
    ← { executionId }
  poll every 1s:
    queryRepo.getQuery → GET /api/query/:id → Athena.GetQueryExecution
      QUEUED → RUNNING → SUCCEEDED / FAILED / CANCELLED
    on SUCCEEDED → queryRepo.getResults → GET /api/query/:id/results
```

Polling, not WebSocket. Athena queries are seconds-to-minutes; 1 Hz is fine and WebSocket would need sticky sessions on the ALB.

### `load more` fast-path (large result sets)

```
First page:  GET /api/query/:id/results    → Athena.GetQueryResults (1000 rows)
Beyond:      GET /api/query/:id/results-url → S3 presign
             browser fetch → full CSV → client-side parse
```

Past page 1 we collapse to S3-direct. The proxy never streams a multi-MB result CSV.

### CreateTable (review flow)

```
User clicks register-table →
  POST /api/datasets/analyze → inference + location plan + findings
  user reviews, accepts resolutions
  (optional browser-side move: copy + delete via S3Client)
  POST /api/datasets/create-table with the resolved plan
    → proxy: ensureDatabase → [DROP] → CREATE TABLE → [CREATE OR REPLACE VIEW]
```

See [the ticket-18 plan](../.claude/plans/delightful-leaping-axolotl.md) for the decision tree; findings detail in `packages/proxy/src/services/findingsDetector.ts`.

## Proxy composition

`server.ts` is a factory: `createServer(config) → Express`. Middleware order:

```
requestId
express.json
morgan (request log)
/api/health        ← unauthenticated
/api/<rest>:
  authenticate        → req.user
  passthroughCredentials → req.awsCredentials
  /session, /schema, /query, /history, /datasets, /saved-queries
errorHandler (final)
```

Routes parse HTTP (params, query, body), call services, shape responses. Services wrap AWS SDK calls and translate AWS shapes → our shared types. **No AWS SDK imports in routes, no HTTP awareness in services.** A future CLI could reuse the services layer without HTTP.

Every route's AWS client is built per-request from `req.awsCredentials` — that's how credential passthrough reaches each AWS call.
