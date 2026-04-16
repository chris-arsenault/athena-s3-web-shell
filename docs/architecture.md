# athena-shell architecture

This document is the source of truth for how athena-shell is built. If you're picking up development cold, read this end-to-end. For day-to-day conventions and gotchas see [CLAUDE.md](../CLAUDE.md); for the user-facing summary see [README.md](../README.md).

---

## 1. Why this exists

Non-technical federal users need two things from AWS that the AWS console serves badly:

1. **Move files in and out of S3** — the console's S3 page is workable but assumes IAM literacy and offers no concept of "your" workspace.
2. **Run ad-hoc SQL against those files via Athena** — the Athena console exposes workgroups, output locations, query catalogs, and row-limit gotchas that confuse end users.

Free desktop tools like DBeaver solve the SQL UX, but **none support Cognito-federated SSO** — required because federal users authenticate via Entra ID, not user/password databases.

athena-shell is a **thin web shell over the AWS APIs that already do the work**, with two design priorities:

- **Almost no business logic.** The IAM role enforces permissions. Workgroups enforce query budgets. We don't reimplement these — we just present them.
- **Fits in a federal enclave.** No internet egress, no API Gateway, no edge runtimes, no third-party SaaS. Everything ships as one ECS Fargate task.

---

## 2. Constraints that shape every decision

### 2.1 Federal enclave deployment
Production runs inside a VPC on AWS commercial (NOT GovCloud) with **no internet egress**. This eliminates the architectural patterns most SaaS apps would reach for first:

- ❌ API Gateway — internet-facing by default
- ❌ CloudFront / Cloudflare / Vercel Edge — external network plane
- ❌ Lambda@Edge
- ❌ Any SaaS dependency reachable only over the public internet
- ❌ Public package installs at runtime (image pulls go through interface ECR endpoints)

What's left:
- ✅ ECS Fargate behind an internal ALB
- ✅ AWS service calls via VPC interface/gateway endpoints
- ✅ Cognito (via interface endpoint) once auth is wired
- ✅ S3 via gateway endpoint

### 2.2 Standard tech over novel tech
Per the project owner: federal review boards and team members are more comfortable with mature, widely-known dependencies. We use Express (not Hono), Vite (not Webpack/Bun), AWS SDK v3 (the only choice), and idb (the lightest sane IndexedDB wrapper). Any time you reach for something newer, justify it in writing.

### 2.3 Thin shell, not a platform
Don't build features that AWS already gives us. Bucket policies, IAM roles, workgroup quotas, Athena query history, Glue catalog — these are all the source of truth. The shell renders them and wires UX flows. If a feature requires duplicating IAM logic in TypeScript, that's a smell.

---

## 3. System architecture

### 3.1 Top-down view

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Federal enclave VPC                           │
│                                                                     │
│  Browser ─── TLS ───► internal ALB ─── HTTP ───► ECS Fargate task   │
│      │                                            ┌─────────────┐   │
│      │                                            │  Container  │   │
│      │                                            │             │   │
│      │                                            │  Express    │   │
│      │  ┌─────────────────────────────────────────┤   /api/*    │   │
│      │  │ /api responses (Athena, Glue, presigns) │             │   │
│      │  │                                         │  /* (SPA)   │   │
│      │  │ /* SPA static assets                    │             │   │
│      │  │                                         └─────┬───────┘   │
│      │                                                  │           │
│      │                                                  │ AWS SDK v3│
│      │                                                  ▼           │
│      │                              ┌──── VPC interface endpoints ──│
│      │                              │   Athena, Glue, STS, Logs,    │
│      │                              │   ECR, Secrets, SSM, KMS      │
│      │                              └───────────────────────────────│
│      │                                                              │
│      │  AWS SDK v3 (browser bundle)                                 │
│      └──────────────────► S3 (gateway endpoint) ─── data bucket     │
│                                                  ─── athena results │
└─────────────────────────────────────────────────────────────────────┘
```

Two traffic paths matter:

1. **SPA → proxy → AWS** for Athena, Glue, and Athena-results presigning. The proxy is the only place that holds workgroup config and minting result-download URLs.
2. **SPA → S3 directly** for file list/upload/download/delete. The browser holds short-lived STS credentials (issued via Cognito Identity Pool in v2; mocked in v1) and the bucket policy + IAM role enforce scope. **No proxy round-trip for S3 ops** — keeps multi-GB uploads off the proxy and removes a memory bottleneck.

This is the **hybrid AWS access pattern**, decided up front. The alternative ("everything through the proxy") was rejected because the proxy would have to assemble multipart uploads in memory and stream multi-GB downloads back to the browser; not viable for ad-hoc datasets.

### 3.2 The single-container choice

Both halves — Express proxy and built SPA — ship in **one container**. The Dockerfile copies `packages/web/dist/` into the proxy's `/app/public/`, and `serveSpa.ts` mounts it as static + an SPA history fallback. There is one ALB target group, one image to deploy, one healthcheck.

We considered serving the SPA from a separate Fargate task or from S3+CloudFront. Both were rejected:
- Separate Fargate task: doubles deployment surface for a 22 MB asset bundle that doesn't change independently of the proxy.
- S3+CloudFront: CloudFront is internet-facing by default; the enclave forbids it.

The trade-off: SPA and proxy are version-locked. In practice this is a feature — the `/api` shape and the SPA's expectations evolve together.

### 3.3 Repo layout

```
athena-shell/
├── packages/
│   ├── shared/                         # cross-boundary types only
│   │   └── src/
│   │       ├── types/{auth,query,schema,s3}.ts
│   │       └── constants.ts
│   ├── proxy/                          # Express server
│   │   └── src/
│   │       ├── index.ts                # entrypoint
│   │       ├── server.ts               # express factory (testable)
│   │       ├── config.ts               # env parsing
│   │       ├── auth/                   # AuthProvider impls
│   │       ├── middleware/             # authenticate, errorHandler
│   │       ├── aws/                    # SDK client factories
│   │       ├── routes/                 # /api/* handlers
│   │       ├── services/               # AWS-call helpers, mappers
│   │       ├── static/                 # SPA static-serve mount
│   │       └── utils/                  # asyncHandler, etc.
│   └── web/                            # Vite + React SPA
│       └── src/
│           ├── main.tsx, App.tsx, routes.tsx, index.css
│           ├── auth/                   # AuthProvider impls + context
│           ├── data/                   # api wrapper, repos, IndexedDB, mock fakes
│           ├── hooks/                  # useAsyncAction, usePolling, useDropzone
│           ├── components/             # AppShell, ErrorBoundary, etc.
│           ├── views/
│           │   ├── workspace/          # S3 file browser
│           │   └── query/              # SQL interface
│           └── utils/                  # formatBytes, parseS3Path, etc.
├── eslint-rules/                       # 6 local custom rules
├── docker/Dockerfile                   # multi-stage, single runtime image
└── docs/architecture.md                # this file
```

Conventions: kebab-case dirs, PascalCase for `.tsx` components, camelCase for utility `.ts`, co-located `Component.css` and `Component.test.tsx`. See [CLAUDE.md](../CLAUDE.md#lint-rules-to-know).

---

## 4. Auth architecture

### 4.1 The `AuthProvider` interface

A single abstraction sits in front of all auth logic on both sides of the wire.

**Web** — `packages/web/src/auth/AuthProvider.ts`:
```ts
interface AuthProvider {
  getContext(): Promise<AuthContext>;            // identity + scoping
  getCredentials(): Promise<AwsTempCredentials>; // STS creds for browser-direct S3
  getProxyAuthHeader(): Promise<{ name; value } | null>;  // header for /api calls
  signOut(): Promise<void>;
  isMock(): boolean;                             // repos branch on this
}
```

**Proxy** — `packages/proxy/src/auth/authProvider.ts`:
```ts
interface AuthProvider {
  resolve(req: Request): Promise<AuthContext>;   // attached to req.user by middleware
}
```

Both have a `MockAuthProvider` (active in v1) and a `CognitoAuthProvider` (stub, see [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1)).

### 4.2 `AuthContext` — the identity + scope tuple

The single shape that flows through the system, defined in `packages/shared/src/types/auth.ts`:

```ts
interface AuthContext {
  userId: string;
  displayName: string;
  email: string;
  region: string;
  roleArn: string;
  s3:     { bucket: string; prefix: string };          // workspace scope
  athena: { workgroup: string; outputLocation: string;
            defaultDatabase?: string };
}
```

Every component reads scoping from this object. The proxy attaches it to `req.user` via `middleware/authenticate.ts`. The SPA reads it from `useAuth().context`. **There is no other source of "what the user can do."**

### 4.3 Mock mode (v1, default)

`MockAuthProvider` returns a hardcoded identity and tells repos to route to in-memory fakes:

- Web: `data/mockS3Store.ts` (an in-memory file system seeded with sample CSVs) and `data/mockAthena.ts` (databases, tables, query lifecycle simulation with realistic state transitions).
- Proxy: `MockAuthProvider` reads `X-Mock-User` header against `MOCK_USERS_JSON` env var; defaults to a single `dev-user` AuthContext.

The full app is functional end-to-end in mock mode with **no AWS credentials**. This is the dev default and the integration-test default.

### 4.4 Cognito mode (v2, [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1))

Designed but not implemented. The intended flow:

1. SPA boots, has no token → `CognitoAuthProvider.getContext()` redirects to Cognito Hosted UI
2. Cognito hands off to Entra ID (SAML or OIDC) for the actual auth ceremony
3. Entra returns to Cognito; Cognito returns to the SPA with an ID token
4. SPA exchanges the ID token for STS credentials via Cognito Identity Pool → these go to `getCredentials()` for browser-direct S3
5. SPA passes the ID token as `Authorization: Bearer <jwt>` on every `/api/*` call
6. Proxy verifies the JWT via `aws-jwt-verify` against cached Cognito JWKS, derives `AuthContext` from claims, attaches `req.user`
7. (Per [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2)) Proxy then calls `STS.AssumeRoleWithWebIdentity` to get per-user creds for AWS calls — IAM, not app code, enforces scope

Because the abstraction is in place, swapping providers is a one-line change in `App.tsx` and `middleware/authenticate.ts`.

---

## 5. Data layer

### 5.1 The `api.ts` chokepoint

`packages/web/src/data/api.ts` is **the only place in the SPA that calls `fetch`**. The `local/no-direct-fetch` ESLint rule enforces this. `api.ts` exports `apiGet`/`apiPost`/`apiDelete` which:

- Inject the `AuthProvider`'s proxy header (mock or bearer)
- Build URLs from `API_BASE` + path + query params
- Parse JSON responses
- Throw `ApiError` with status + parsed payload on non-2xx

This is the seam where future cross-cutting concerns (request IDs, retries, telemetry) plug in.

### 5.2 Repos: one per resource

Each domain has a repo that abstracts "real AWS vs. mock":

| Repo | Domain | Real path | Mock path |
|---|---|---|---|
| `s3Repo` | S3 file ops | AWS SDK v3 `S3Client` direct from browser | `mockS3Store` (in-memory) |
| `queryRepo` | Athena query lifecycle | `apiPost`/`apiGet` to proxy | `mockAthena` (in-memory) |
| `schemaRepo` | Glue catalog | `apiGet` to proxy | `mockAthena` |
| `historyRepo` | Query history (merged) | `apiGet` to proxy + `localDb.favorites` | `mockAthena` + `localDb.favorites` |
| `localDb` | IndexedDB (drafts, favorites, named) | `idb` library, no remote | same — local only |

The branch is always `if (provider.isMock()) return mockX(...); else return apiCall(...);` — explicit, greppable, no Magic Strategy registry.

### 5.3 IndexedDB schema

`localDb.ts` defines DB `athena-shell` v1 with three object stores:

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `drafts` | `id` (autoincrement) | `updatedAt` | Editor autosave |
| `favorites` | `id` (autoincrement) | `executionId` (unique) | Starred queries |
| `namedQueries` | `id` (autoincrement) | `name` (unique) | Saved queries |

`historyRepo.list()` merges Athena's `ListQueryExecutions` page with local favorites. Favorites tagged `source: "local"` show up even when the underlying execution has aged out of Athena's 45-day retention.

### 5.4 Browser-direct S3: client construction

```ts
new S3Client({
  region: ctx.region,
  credentials: () => provider.getCredentials(),  // function, so SDK refreshes
});
```

Passing a function (not a literal) lets the SDK call back when creds expire. The `CredentialsCache` (in `auth/credentialsCache.ts`) wraps the provider with a 5-minute skew refresh, so concurrent S3 ops don't fan out to N STS calls.

---

## 6. Request flows

### 6.1 Workspace: list a folder

```
Browser
  WorkspaceView mounts
  └─ effect: listFolder(provider, ctx, prefix)
      └─ s3Repo.listFolder
          ├─ ensureScoped(ctx, prefix)   ← rejects ".." and out-of-prefix paths
          ├─ if isMock → mockS3.list(prefix) → sorted folders+objects
          └─ else → S3Client.send(ListObjectsV2Command{Delimiter:"/"})
              → CommonPrefixes = subfolders, Contents = files
  Render FileBrowser with folders + objects
```

**Why `Delimiter:"/"`**: gives us the hierarchical view S3 doesn't actually have. CommonPrefixes are virtual folders; Contents are leaf objects.

### 6.2 Workspace: upload a file

```
User drops files
  UploadDropzone → useDropzone → walks DataTransferItem.webkitGetAsEntry()
    └─ recursive directory walk yields DroppedFile[] with relativePath
      └─ useUploads.enqueue(files)
          └─ for each file:
              create UploadProgress {id, status: "pending"}
              call s3Repo.uploadFile(provider, ctx, key, file, ...)
                ├─ ensureScoped(ctx, key)
                ├─ if isMock → simulateUploadProgress (timer-based fake)
                └─ else → @aws-sdk/lib-storage Upload class
                    ├─ partSize 5MB, queueSize 4
                    ├─ on httpUploadProgress → updates UploadProgress
                    └─ done → succeeded
              on success → refresh listing
              on failure → mark UploadProgress as "failed" with error
```

**Multipart for everything ≥5MB.** `lib-storage` does it transparently — single PUT for small, multipart for large, retries on transient errors, abortable. The `AbortIncompleteMultipartUpload` lifecycle rule on the bucket cleans orphan parts (deployment-side concern, see §8).

### 6.3 Query: schema browse

```
SchemaTree mounts
  └─ schemaRepo.listDatabases(provider)
      └─ apiGet("/schema/databases") → proxy → Glue.GetDatabases
  user expands a database
      └─ schemaRepo.listTables(provider, db)
          └─ apiGet(`/schema/databases/${db}/tables`) → Glue.GetTables
  user expands a table
      └─ schemaRepo.getTable(provider, db, table)
          └─ apiGet(`/schema/databases/${db}/tables/${table}`) → Glue.GetTable
              → returns columns + partitionKeys + location
```

Pagination is wired in the API but the SPA only shows page 1 of each level today. Add a "show more" affordance later if catalogs grow.

### 6.4 Query: run a query end-to-end

```
User clicks Run
  QueryView → useQueryRunner.run()
    ├─ queryRepo.startQuery(provider, {sql})
    │   └─ apiPost("/query", {sql})
    │       └─ proxy: services/queryService.startQuery
    │           └─ Athena.StartQueryExecution with workgroup + outputLocation
    │           ← returns {executionId}
    ├─ poll loop: every 1s
    │   └─ queryRepo.getQuery(provider, executionId)
    │       └─ apiGet(`/query/${id}`) → Athena.GetQueryExecution
    │           ← state: QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED
    │   ├─ if terminal SUCCEEDED → fetch results
    │   ├─ if FAILED → surface stateChangeReason as error
    │   └─ timeout at 10 minutes
    └─ queryRepo.getResults(provider, executionId)
        └─ apiGet(`/query/${id}/results`) → Athena.GetQueryResults (page 1, 1000 rows)
            ← columns + rows
ResultsTable renders; HistoryPanel re-fetches; the query is now in Athena's history
```

**Polling, not long-poll or WebSocket.** Athena queries are typically seconds-to-minutes; 1-second polling is fine. WebSocket would require sticky sessions on the ALB and cost more than it saves.

**Stop button**: `queryRepo.stopQuery` → `DELETE /api/query/:id` → `Athena.StopQueryExecution`. The poll loop sees state `CANCELLED` and exits.

### 6.5 Query: download CSV

```
User clicks ⬇ CSV
  ResultsTable: in mock mode, build CSV in browser from current results page
  In real mode (post-v1 wiring):
    queryRepo.getDownloadUrl(provider, executionId)
      └─ apiGet(`/query/${id}/download`)
          └─ proxy: getQuery → outputLocation = "s3://bucket/key.csv"
          └─ proxy: presignResultsDownload → S3 presign 15-min URL
          ← returns {url}
  Browser navigates to presigned URL, downloads directly from S3
```

The proxy never streams the CSV body. This is the single largest "don't blow up the proxy" decision.

### 6.6 History: merging Athena + IndexedDB

```
HistoryPanel → historyRepo.list(provider)
  ├─ remote: apiGet("/history") → proxy → ListQueryExecutions + BatchGetQueryExecution
  ├─ local: localDb.favorites.list() → IndexedDB
  ├─ merge by executionId; favorites get source: "local" if not present remotely
  └─ sort by submittedAt desc
```

Toggle favorite: writes to IndexedDB only; doesn't touch Athena. Athena's history is read-only from our perspective.

---

## 7. Frontend internals

### 7.1 Routing
`react-router-dom` `createBrowserRouter`. Two routes: `/workspace` and `/query`, plus `/` redirects to `/workspace`. The proxy's `serveSpa.ts` mounts an SPA-history fallback so deep links work.

### 7.2 State
Per-component `useState`/`useReducer`. Auth lives in React context (`auth/authContext.tsx`). No global store. The data layer is "fetch on mount, cache locally if needed" — for a tool this size that's plenty.

### 7.3 Hooks worth knowing
- `useAsyncAction(fn)` — idle/loading/success/error state machine. Returns `{status, data, error, run, reset, isLoading}`. Use this for any async action triggered by user interaction.
- `usePolling({fn, intervalMs, until, timeoutMs, enabled})` — generic poller with timeout. Used by query lifecycle.
- `useDropzone(onFiles)` — HTML5 drag-drop with directory traversal via `webkitGetAsEntry`. Browser support: Chrome/Edge/Firefox; Safari is partial.

### 7.4 Monaco editor
Lazy-loaded. `SqlEditor.tsx` is a `Suspense` wrapper; `SqlEditorImpl.tsx` does the actual `monaco-editor` import. The Vite plugin `vite-plugin-monaco-editor` emits the editor worker as a separate chunk. The lazy chunk is ~3.3 MB / 856 KB gzipped — acceptable because it loads only when a user opens the Query view.

If you ever import from `monaco-editor` outside `SqlEditorImpl.tsx`, the bundle splits break and the main chunk doubles. Don't.

### 7.5 Styling
Plain CSS, co-located. `src/index.css` defines:
- All theming via CSS custom properties (`--color-*`, `--space-*`, `--radius-*`, `--font-*`)
- Utility classes for layout (`.flex-row`, `.flex-col`, `.gap-2`, `.ml-auto`, `.text-muted`, `.truncate`, `.cursor-pointer`)

`local/no-inline-styles` is an error. The escape hatch — for genuinely dynamic values like progress-bar widths — is a per-line eslint disable with a comment explaining why. There's exactly one in the codebase right now (in `UploadQueue.tsx` for the bar fill width).

---

## 8. Backend internals

### 8.1 Server composition
`server.ts` is a factory: `createServer(config) → Express`. This is what tests use. `index.ts` is the entrypoint that loads config, creates the server, and listens. Keeping the factory testable is why the proxy has supertest tests covering routes.

Middleware order matters:
```
express.json (body parser)
morgan (request log)
healthRouter (no auth — load balancer needs this even when auth is broken)
auth router:
  authenticate middleware → req.user
  /session, /schema, /query, /history, /query/:id/download
errorHandler (final)
```

Anything before `authenticate` is unauthenticated. Anything after gets `req.user`.

### 8.2 AWS clients
Currently process-singletons (`createAthenaClient`, `createGlueClient`, `createS3Client`) using the task role. Per-request construction with assumed-role creds is on the backlog ([#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2)) and will replace these with a per-request factory.

### 8.3 Services vs routes
- **Routes** parse HTTP (params, query, body), call services, shape responses. No AWS SDK imports in routes.
- **Services** wrap AWS SDK calls and translate AWS shapes → our shared types. No HTTP awareness.

This split exists so a future caller (CLI, other service) could reuse services without HTTP. It also keeps routes scannable.

### 8.4 Error handling
Routes are wrapped in `asyncHandler(fn)` which forwards async errors to the `errorHandler` middleware. Errors with a `.status` field set the HTTP status; everything else is 500. 5xx errors are logged with the stack; 4xx are not (they're noise).

`UnauthorizedError` (in `auth/authProvider.ts`) has `status = 401`.

### 8.5 Static SPA
`mountSpa(app, staticDir)`:
- `express.static(root, {index: false})` serves built assets
- `app.get(/^\/(?!api\/).*/, ...)` is the SPA history fallback — anything not under `/api` returns `index.html`

This is mounted **after** the API routes so they take precedence.

---

## 9. Deployment topology

### 9.1 Container
Multi-stage Dockerfile in `docker/Dockerfile`:

1. **Builder** — `node:20-alpine` + pnpm 10.29.3, runs `pnpm install` then builds all three packages
2. **Deploy stage** — `pnpm --filter @athena-shell/proxy --prod --legacy deploy /tmp/deploy` produces a flat `node_modules` tree without pnpm's symlink layout (which doesn't survive `COPY` cleanly)
3. **Runtime** — `node:20-alpine`, copies `/tmp/deploy` and `packages/web/dist`, runs as non-root `app` user, healthcheck on `/api/health`, `CMD ["node", "dist/index.js"]`

Image size is dominated by Monaco's lazy chunk (~22 MB SPA assets in the image; chunked over the wire as the user navigates).

### 9.2 ECS Fargate task

| Setting | Value |
|---|---|
| Network mode | `awsvpc` (required for Fargate) |
| CPU / memory | 1 vCPU / 2 GB (start; size up if Athena polling becomes hot) |
| Container port | 8080 |
| Task role | See §9.3 |
| Execution role | Standard (ECR pull, CloudWatch Logs) |
| Healthcheck | `GET /api/health` |
| Subnets | Private (no public IP) |
| Security group | Inbound from internal ALB SG only |

### 9.3 Task IAM role (v1)

Currently the task role does all AWS work directly (per-user `AssumeRoleWithWebIdentity` is [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2)). Required policies:

```jsonc
{
  "Statement": [
    { "Effect": "Allow",
      "Action": [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:StopQueryExecution",
        "athena:GetQueryResults",
        "athena:ListQueryExecutions",
        "athena:BatchGetQueryExecution"
      ],
      "Resource": "arn:aws:athena:REGION:ACCT:workgroup/WORKGROUP" },
    { "Effect": "Allow",
      "Action": ["glue:GetDatabases", "glue:GetTables", "glue:GetTable"],
      "Resource": "*" },
    { "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::DATA-BUCKET",
        "arn:aws:s3:::DATA-BUCKET/*"
      ] },
    { "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::ATHENA-RESULTS-BUCKET/*" }
  ]
}
```

**After [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2) lands**, the task role shrinks to only `sts:AssumeRoleWithWebIdentity` against the per-user role ARNs; user roles carry the policies above scoped to that user's prefix.

### 9.4 Required VPC endpoints

All as **interface endpoints with private DNS enabled**, except S3 which is a **gateway endpoint**:

| Service | Type | Why |
|---|---|---|
| S3 | gateway | data bucket, Athena results bucket, ECR layers |
| Athena | interface | query lifecycle |
| Glue | interface | catalog browse |
| STS | interface | (post-#2) AssumeRoleWithWebIdentity, plus current Cognito Identity Pool exchange |
| Logs (CloudWatch) | interface | container logs |
| ECR API + DKR | interface | image pulls (ECR is not internet-reachable from the enclave) |
| Secrets Manager | interface | future Cognito client secret, JWKS cache config |
| SSM | interface | runtime config |
| KMS | interface | only if data buckets use SSE-KMS |
| Cognito IDP + Cognito Identity | interface | future ([#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1)) |

Bucket policies must restrict to `aws:SourceVpce` matching the S3 endpoint.

### 9.5 S3 CORS (browser-direct uploads)

The data bucket needs CORS so the SPA can `PUT` to it:

```jsonc
[
  {
    "AllowedOrigins": ["https://internal-alb-hostname"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

This is set outside this repo (Terraform/CloudFormation in your deployment repo). Without it, multipart uploads from the SPA will fail at the browser preflight.

### 9.6 Multipart abort lifecycle

```jsonc
{
  "Rules": [
    {
      "ID": "abort-orphan-multipart",
      "Status": "Enabled",
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

Without this, abandoned multipart uploads (browser tab closed mid-upload) accumulate as billed storage forever.

---

## 10. Security model

### 10.1 Layers of defense

In order from outermost to innermost:

1. **Network**: ALB internal-only, security group restricts ingress, no public IP on the task.
2. **Auth**: SPA cannot reach `/api` without an auth header (mock or JWT). Healthcheck is the only unauthenticated route.
3. **App-level scoping**: `req.user.s3.prefix` and `req.user.athena.workgroup` are passed into every AWS call. Path-traversal guard (`isWithinPrefix`) on every S3 op.
4. **IAM**: today the task role's policy bounds what's possible; post-[#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2), per-user role policies do.
5. **Bucket policy**: restricts to `aws:SourceVpce`, blocks public access.
6. **Audit**: today only HTTP request logs ([#3](https://github.com/chris-arsenault/athena-s3-web-shell/issues/3) adds structured query/op audit).

### 10.2 Things to remember

- **Browser-visible STS creds are not a vulnerability** when scoped tightly and short-lived. They are visible in DevTools — that's expected. The IAM policy is what makes them safe.
- **Don't trust SPA-side prefix checks alone.** They're UX guardrails (better error messages, fewer accidental clicks). The IAM role is the actual enforcement.
- **SQL queries are user-typed.** Athena handles parameter binding only via parameterized queries; we don't enforce parameterization. Workgroup data-scanned limits are the safety net for accidental full-table scans on huge tables.
- **CSV download is presigned to S3 directly** so multi-GB results don't pass through proxy memory.

---

## 11. Extension points

### 11.1 Adding a new proxy endpoint

1. New file `packages/proxy/src/routes/<topic>.ts`. Use existing routes as templates — `Router()`, `asyncHandler` wrapping handlers, AWS clients constructed at the top.
2. Register in `server.ts` under the `apiAuth` router.
3. AWS-side logic goes in `services/<topic>Service.ts`. Routes parse HTTP; services do the AWS work.
4. New shared types go in `packages/shared/src/types/<topic>.ts` and re-export from `index.ts`.
5. SPA repo wrapper in `packages/web/src/data/<topic>Repo.ts` with the standard `if (provider.isMock()) return mockX(); else return apiCall();` shape.
6. Extend the mock fakes in `data/mockS3Store.ts` or `data/mockAthena.ts` so dev mode keeps working.
7. Tests: route via supertest in proxy, repo via vitest in web (mock the api wrapper or the provider).

### 11.2 Adding a new SPA view

1. `packages/web/src/views/<area>/<View>.tsx` + `.css` + `.test.tsx`.
2. Use existing views as templates — `useAuth()` for context, repos for data, hooks for state machines, `ErrorBanner` for errors, `LoadingSpinner` for loading.
3. Register in `routes.tsx`.
4. Add a nav link in `components/AppShell.tsx` if it should appear in the sidebar.
5. Keep the component under 75 lines (lint cap). Extract sub-components and hooks aggressively.

### 11.3 Adding a new shared type
Just add the file, export from `index.ts`. The proxy and web both consume `@athena-shell/shared` as a workspace dep. **Rebuild shared** (`pnpm --filter @athena-shell/shared build`) for the proxy to see it at runtime; in dev the watch script handles this.

### 11.4 Replacing the AuthProvider
Implement the interface, instantiate it in `App.tsx` (web) and `middleware/authenticate.ts` (proxy). Both implementations must agree on the `AuthContext` shape they produce. Drive the choice from env (e.g., `AUTH_PROVIDER=cognito|mock`).

---

## 12. Testing posture

Vitest only (lint enforces). What's covered:

- **Pure utils**: every `utils/*.ts` has a `.test.ts`
- **IndexedDB layer**: `localDb.test.ts` runs against `fake-indexeddb`
- **Proxy routes**: `server.test.ts` boots `createServer({mockAuth: true})` and hits routes via supertest
- **Service mappers**: where there's non-trivial AWS-shape → our-shape translation

Not covered:
- Real AWS SDK calls (covered by future integration smoke tests against a sandbox account)
- Monaco render
- Drag-drop DOM events
- React snapshot tests (intentional — they rot fast)

Run a single test file: `cd packages/web && pnpm vitest run src/utils/parseS3Path.test.ts`.

---

## 13. Performance

### 13.1 Bundle
- Main SPA bundle: ~175 KB gzipped
- Monaco lazy chunk: ~856 KB gzipped (loads only on `/query`)
- Per-language chunks: ~3-15 KB each (Monaco loads them on demand)

If main bundle starts climbing past 300 KB, audit imports. The usual suspect is something accidentally importing from `monaco-editor` outside the lazy boundary.

### 13.2 Proxy memory
Stays flat under all current operations because:
- Athena results paginate (1000 rows max per `GetQueryResults`)
- Athena CSV downloads are presigned, not streamed through proxy
- Glue catalog responses are small
- S3 ops don't touch the proxy at all

If you add an endpoint that returns more than ~1 MB of body, think hard about streaming or presigning instead.

### 13.3 Known cliffs
- ResultsTable with >5000 DOM rows starts to feel sluggish. Virtualization is in [#4](https://github.com/chris-arsenault/athena-s3-web-shell/issues/4).
- Polling at 1Hz is fine for a single user; with 100 concurrent users running queries, the proxy makes 100 RPS to Athena which can hit account-level rate limits. Consider exponential backoff or server-side polling consolidation if this becomes real.

---

## 14. Roadmap

Backlog tracked as GitHub issues:

| Issue | Why it matters |
|---|---|
| [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1) Cognito + Entra federation | The actual auth — without this it's a demo |
| [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2) AssumeRoleWithWebIdentity per request | Move enforcement from app code to IAM |
| [#3](https://github.com/chris-arsenault/athena-s3-web-shell/issues/3) Audit logging | Federal compliance requirement |
| [#4](https://github.com/chris-arsenault/athena-s3-web-shell/issues/4) Result streaming + virtualized table | Handle real-world large result sets |
| [#5](https://github.com/chris-arsenault/athena-s3-web-shell/issues/5) S3 → Athena table auto-creation | Closes the "drop a file, query it" loop the product is named for |

Out of scope and **not currently tracked**: query sharing/versioning, charting, mobile layouts, i18n, theme toggle, Glue crawlers, cost warnings.

---

## 15. Decisions log (the "why" register)

The non-obvious choices, in case you wonder why something is the way it is:

| Decision | Rationale |
|---|---|
| Hybrid AWS access (S3 direct, Athena via proxy) | Multi-GB browser→S3 uploads/downloads can't go through proxy memory. Athena/Glue go through proxy so workgroup config and result presigning live in one place. |
| Single Fargate task serving SPA + API | Federal enclave forbids CloudFront. S3+ALB-static was considered and rejected as more plumbing for no real benefit. |
| Express, not Hono/Fastify | User explicitly wanted standard tech for federal review boards. |
| Monaco, not CodeMirror | Matches DBeaver polish users expect. The bundle penalty is acceptable because it's lazy-loaded. |
| Plain CSS, not CSS modules / styled-components | Mirrors ahara-standards. Simpler bundle, simpler debugging. |
| pnpm workspaces, not turbo/nx | Three packages don't justify a build orchestrator. pnpm's recursive runner is enough. |
| Vite 5, not 6 | Vitest 2.x ships vite 5; mixing breaks plugin types. |
| Mock everything in dev | Federal contributors may not have AWS sandbox access. The mock layer is intentional, not a stopgap. |
| IndexedDB for query history (merged with Athena) | Local favorites survive Athena's 45-day retention. No backend state to manage. |
| `AuthProvider` interface from day one | The Cognito work is large; we wanted to ship the shell while it's deferred. The abstraction is the only way to swap providers cleanly later. |
| Per-request `AssumeRoleWithWebIdentity` deferred | Requires Cognito to be wired first, and the v1 task-role-with-app-side-scoping is acceptable for a closed pilot. |
