# CLAUDE.md

Project-specific guidance for Claude Code (and any AI agent) working on athena-shell. **Read this before making changes.** For the full architecture, see [docs/architecture.md](docs/architecture.md).

## What this project is

A web shell over AWS Athena and S3 for users in **VPC-bound / network-restricted environments** — places where the app must run inside a private VPC with no internet egress. Two features behind a single SSO login:
1. **Personal Workspace** — drag-drop S3 file management against a bucket+prefix scoped to the user's IAM role.
2. **SQL Query Interface** — web "DBeaver for Athena" with schema explorer, Monaco editor, results, and history.

Intentionally a **thin shell over AWS APIs**. The IAM role enforces access; we don't reimplement what AWS already gives us. When you find yourself writing custom auth/permission/quota logic, stop and ask whether IAM/Athena/S3 already provides it.

## Hard constraints (do not violate)

### VPC-bound deployment, no internet egress
The production target is a private VPC on AWS commercial, with **no internet egress**. This precludes:

- ❌ API Gateway (default internet-facing)
- ❌ CloudFront / Cloudflare / any edge runtime
- ❌ Lambda@Edge
- ❌ Third-party SaaS with internet-only endpoints

Everything runs inside the VPC. AWS calls go through VPC interface/gateway endpoints. The proxy + SPA ship as **one ECS Fargate task** behind an internal ALB. Reject any architecture suggestion that violates this.

### Tech preference: standard over novel
For dependencies, default to mature/widely-known options. Express was chosen over Hono explicitly because it's mature and widely understood — security review boards and onboarding contributors do better with boring tech. Avoid:

- Hono, Bun, edge-runtime-only frameworks
- Bleeding-edge React patterns (signals libraries, RSC tooling that's still in flux)
- Novel state management (zustand is fine if needed; we currently have none)

### Auth + scope guards
Every S3 operation must enforce `key.startsWith(authContext.s3.prefix)` and reject paths containing `..` (see `packages/web/src/utils/parseS3Path.ts:isWithinPrefix`). Every Athena call must pass `req.user.athena.workgroup` and `req.user.athena.outputLocation`. The proxy currently uses its own task role and enforces in-app; per-request `AssumeRoleWithWebIdentity` is on the backlog ([#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2)).

## How to run, test, lint, build

```sh
pnpm install
MOCK_AUTH=1 pnpm dev          # SPA :5173, proxy :8080, no AWS needed
pnpm test                      # Vitest, all 3 packages
pnpm typecheck                 # tsc --noEmit, all 3 packages
pnpm lint                      # ESLint flat config v9
pnpm build                     # shared + proxy tsc, web vite build
make docker                    # production image
make docker-run                # run image on :8080 with MOCK_AUTH=1
```

If you change the `shared` package, the `dev` script keeps it compiled in watch mode (it's a real built dependency, not a path alias — see [Gotchas](#gotchas)).

## Lint rules to know

ESLint flat config v9 with **6 local custom rules** in `eslint-rules/`:

| Rule | Severity | What it catches |
|---|---|---|
| `local/max-jsx-props` | warn (12) | Components with too many props — refactor to a props object |
| `local/no-inline-styles` | error | `style={{...}}` on JSX. Use co-located `Component.css` instead. For dynamic values only, add `// eslint-disable-next-line local/no-inline-styles` with a comment |
| `local/no-direct-fetch` | error | Calling `fetch()` outside `data/api.ts`. Use `apiGet`/`apiPost`/`apiDelete` |
| `local/no-non-vitest-testing` | error | Imports from jest/mocha/chai/etc — Vitest only |
| `local/no-js-file-extension` | error | `.js`/`.jsx` source. Use `.ts`/`.tsx` (configs and `eslint-rules/` are exempt) |
| `local/no-raw-undefined-union` | warn | `T \| undefined` in type positions. Use `prop?: T` or a named alias |

Plus complexity caps: `complexity: 10`, `max-lines: 400`, `max-lines-per-function: 75`, `max-depth: 4`. **These are enforced — exceeding them blocks lint.** Refactor with helpers/extracted hooks rather than disabling.

Naming:
- Directories: `kebab-case`
- TS utility files: `camelCase.ts`
- React components: `PascalCase.tsx`
- Co-located CSS + tests: `Component.tsx` + `Component.css` + `Component.test.tsx`

Styling:
- Plain CSS only, co-located per component
- No inline styles, no CSS modules, no styled-components
- CSS custom properties for theming — `src/index.css` defines the full token system:
  - **Palette** (raw): `--ink-900..500` (surfaces), `--bone-100..500` (text), `--rust-300..700` (brand/action), `--phosphor-400..600` (live/success), `--amber-400..500`, `--crimson-500..600`, `--blueprint-400..600`
  - **Semantic aliases**: `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, `--color-success`, etc. Components should use the semantic alias — touch raw tokens only when you genuinely need the shade.
  - **Scales**: `--s-0..8` (spacing 2→64), `--r-0..2` (radii, stay sharp — this is a console kit), `--dur-fast/base/slow`, `--ease-snap/out`, `--font-display` (Fraunces + serif fallbacks), `--font-ui` / `--font-mono` (Berkeley / JetBrains / Plex / system mono stack — everything UI is monospace).
- Shared atoms in `index.css`: `.tok` (bracketed status badge, modifiers `.tok-live/warn/danger/info/accent`), `.dot` (pulsing indicator), `.reg` (register-mark corners for framed panels), `.btn` family, `.kbd`, `.stagger > *` for orchestrated reveals.
- Aesthetic: "operator console" — warm ink ground, rust brand, phosphor accent, monospace typography. Don't revert to generic dark-SaaS tokens.
- Utility classes for layout: `.flex-row`, `.flex-col`, `.gap-2`, `.ml-auto`, `.text-muted`, `.tnum`, `.tracked`, `.truncate` etc. Defined in `src/index.css`. **See gotcha #9 for the `.flex-row` centering pitfall.**

## Auth model: Mock vs Cognito

There is one `AuthProvider` interface and two implementations.

**`MockAuthProvider`** (default in v1):
- Returns a hardcoded dev identity (`dev-user`, bucket `athena-shell-dev`, prefix `users/dev/`, workgroup `primary`)
- `isMock()` returns `true` — repos check this and route to `mockS3Store` and `mockAthena` (in-memory fakes) instead of real AWS
- The proxy's `MockAuthProvider` reads `X-Mock-User` header against `MOCK_USERS_JSON` env var; defaults to a single `dev-user`

**`CognitoAuthProvider`** (stub, [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1)):
- Currently throws "not implemented"
- v2 will: hosted-UI redirect for SAML/OIDC via Entra → STS creds via Cognito Identity Pool → JWT bearer to proxy → proxy verifies via `aws-jwt-verify`

Both are wired in `App.tsx` and `middleware/authenticate.ts`. To swap, change which class is instantiated (eventually env-driven).

## API shape

All proxy endpoints under `/api`. Auth header (mock or bearer) attached to every request by `data/api.ts`. Routes:

| Endpoint | AWS call |
|---|---|
| `GET /api/health` | — |
| `GET /api/session` | returns `AuthContext` |
| `GET /api/schema/databases` | Glue ListDatabases |
| `GET /api/schema/databases/:db/tables` | Glue GetTables |
| `GET /api/schema/databases/:db/tables/:t` | Glue GetTable |
| `POST /api/query` | Athena StartQueryExecution |
| `GET /api/query/:id` | Athena GetQueryExecution |
| `DELETE /api/query/:id` | Athena StopQueryExecution |
| `GET /api/query/:id/results` | Athena GetQueryResults (paginated) |
| `GET /api/query/:id/download` | S3 GetObject presign on Athena results |
| `GET /api/history` | Athena ListQueryExecutions + BatchGetQueryExecution |

S3 ops (list/upload/download/delete/mkdir) are **browser-direct** via AWS SDK v3, not via proxy.

## Gotchas

These bit me during the initial build. They'll bite you too.

1. **`shared` is a built package, not a path alias.** Its `package.json` `main` points to `dist/index.js`. Run `pnpm build` (or rely on the `dev` script's watch mode) before the proxy can resolve `@athena-shell/shared`. Do **not** change `main` back to `src/index.ts` — that breaks runtime ESM resolution under Node.
2. **Express `req.params.x` is `string | undefined` under `noUncheckedIndexedAccess`.** Use `req.params.id!` (the route guarantees it). Don't disable the TS strict flag.
3. **Monaco bundle is large** (~3.3 MB / 856 KB gzipped). It's already lazy-loaded in `SqlEditor.tsx` via `React.lazy`. Don't import from `monaco-editor` at module top-level outside `SqlEditorImpl.tsx` or you'll bloat the main bundle.
4. **Vite version is pinned to `^5.4`.** Vitest 2.x's bundled vite is 5.x; mixing vite 6 causes type errors at the plugin boundary. If upgrading either, upgrade both together.
5. **pnpm Docker deploy needs `--legacy`.** Starting pnpm 10, `pnpm deploy` requires `inject-workspace-packages=true` unless you pass `--legacy`. The Dockerfile uses `--legacy`.
6. **`pnpm install` ignores `esbuild` postinstall by default.** The root `package.json` has `pnpm.onlyBuiltDependencies: ["esbuild"]` to allow it. Don't remove this — vite/vitest fail without esbuild's native binary.
7. **Browser-direct S3 needs CORS** on the data bucket. Required headers: `AllowedOrigins: [internal ALB hostname]`, methods `GET PUT POST DELETE HEAD`, `AllowedHeaders: ["*"]`, expose `ETag`. This is set outside this repo (Terraform/CloudFormation).
8. **No console-side enforcement of bucket scope.** The browser sees the user's STS creds and could in theory craft requests outside their prefix — but the IAM role's policy must reject them. Don't trust SPA-side path checks alone; treat them as UX guardrails.
9. **`.flex-row` sets `align-items: center`.** Great for toolbars and inline rows of mixed-height content — wrong for layout containers. If a flex row is meant to hold nav+main or sidebar+panels that should fill their parent's height, override with `align-items: stretch` (see `.console-body` in `AppShell.css` and `.query-view` in `QueryView.css`). Otherwise children collapse to content height and the rest of the viewport goes empty.
10. **Monaco custom theme + completion provider register globally.** `SqlEditorImpl` defines the `athena-shell-dark` theme once (guarded by a module flag) and registers the SQL `CompletionItemProvider` on mount. Both must be disposed on unmount, which the cleanup effect does. If you add a second editor or a second provider, remember the registration is global — two mounted editors = duplicate suggestions.
11. **Schema cache is shared via `SchemaProvider`.** `data/schemaContext.tsx` owns the single copy of databases / tables / columns for a QueryView session; `SchemaTree` and the Monaco completion provider both read from it via `useSchema()`. Don't call `schemaRepo.*` directly from QueryView descendants — you'd create a divergent cache. `SchemaProvider` eager-loads dbs + tables in parallel on mount; columns lazy-load via `loadColumns(db, table)` on first reference (tree expand or `tbl.` autocomplete).

## Where to add things

| Adding... | Where |
|---|---|
| A new proxy endpoint | `packages/proxy/src/routes/<topic>.ts` + register in `server.ts`. AWS call → `services/<topic>Service.ts` |
| A new AWS call | New service in `packages/proxy/src/services/`, called from a route |
| A new SPA view | `packages/web/src/views/<area>/<View>.tsx` + co-located CSS, register in `routes.tsx` |
| A new shared component | `packages/web/src/components/<Component>.tsx` + co-located CSS |
| A new hook | `packages/web/src/hooks/<useThing>.ts` |
| A new util | `packages/web/src/utils/<name>.ts` (write a `.test.ts` next to it) |
| A new shared type | `packages/shared/src/types/<topic>.ts`, re-export from `index.ts` |
| A new mock fixture | Extend `packages/web/src/data/mockS3Store.ts` or `mockAthena.ts` |
| A new consumer of schema data (dbs/tables/columns) | Call `useSchema()` from `data/schemaContext.tsx` — don't call `schemaRepo` directly inside QueryView descendants. Extend `SchemaValue` there if you need new derived state. |
| A new Monaco feature (hover, signature, snippets) | Register inside `SqlEditorImpl`'s mount effect; dispose in the cleanup. Keep the pure logic in a sibling module (see `sqlCompletions.ts` as the pattern). |

## Testing posture

Vitest only. Co-located `*.test.{ts,tsx}` files. Tests cover:
- Every `utils/*.ts` (pure functions)
- `localDb.ts` (with `fake-indexeddb`)
- Proxy routes via supertest
- Proxy services that have non-trivial mapping logic

Not unit-tested:
- Real AWS SDK calls (covered by future integration smoke tests)
- Monaco render
- Drag-drop DOM events
- React component visual output (no snapshot tests; they rot fast)

Run a single test file: `cd packages/web && pnpm vitest run src/utils/parseS3Path.test.ts`.

## Out of scope (v1) — see GitHub issues

- Cognito + Entra wiring → [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1)
- AssumeRoleWithWebIdentity per request → [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2)
- Audit logging → [#3](https://github.com/chris-arsenault/athena-s3-web-shell/issues/3)
- Result streaming + virtualized table → [#4](https://github.com/chris-arsenault/athena-s3-web-shell/issues/4)
- S3 → Athena table auto-creation → [#5](https://github.com/chris-arsenault/athena-s3-web-shell/issues/5)

Also out of scope and **not currently tracked** (mention if user asks):
- Sharing queries between users
- Saved query versioning / diff
- Realtime collaboration
- Charting / pivots of results
- Mobile/responsive layouts
- i18n
- Theme toggle (single dark theme only)
- Glue crawler triggers
- Cost/data-scanned warnings (deferred but valuable)

## Style: writing code in this repo

- **Don't add comments that explain *what* the code does** — well-named identifiers handle that. Reserve comments for *why* (a constraint, an invariant, a workaround).
- **Don't reference the current task** in comments ("added for issue #5", "used by FooView") — that rots fast.
- **Don't add error handling for impossible cases.** Trust internal contracts. Validate at system boundaries (HTTP input, AWS responses).
- **Don't introduce abstractions until you have three concrete uses.** A bug fix is a bug fix, not a refactor.
- **Don't half-implement.** If a feature spans shared + proxy + web, all three layers must land together.
- **Match the existing patterns.** New routes look like existing routes. New views look like existing views. If you're tempted to invent a new shape, ask first.

## When something fails

- TypeScript errors after adding to `shared`: rebuild it (`pnpm --filter @athena-shell/shared build`) then retry typecheck.
- Lint complexity error: extract a helper. Don't bump the threshold.
- Monaco worker errors in dev: check `vite.config.ts` plugin config. Don't import workers manually.
- `pnpm dev` proxy doesn't see `shared` changes: confirm shared's dev script is running (`pnpm -r --parallel dev`) and `dist/` is being emitted.
- Docker build fails on `pnpm deploy`: check `--legacy` is still on the deploy line.
