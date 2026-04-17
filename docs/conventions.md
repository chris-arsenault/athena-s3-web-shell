# Conventions

Rules and gotchas that aren't obvious from reading the code. Everything else — patterns, shapes, where things live — is visible in the source.

## Lint

ESLint flat config v9 with six local rules in `eslint-rules/`:

| Rule | Severity | Catches |
|---|---|---|
| `local/max-jsx-props` | warn (>12) | Components with too many props — refactor to a props object |
| `local/no-inline-styles` | error | `style={{ … }}` on JSX. Co-locate a `Component.css`. Dynamic values: escape with `// eslint-disable-next-line` and a comment explaining why |
| `local/no-direct-fetch` | error | `fetch()` outside `data/api.ts`. Use `apiGet` / `apiPost` / `apiDelete` |
| `local/no-non-vitest-testing` | error | jest / mocha / chai imports — Vitest only |
| `local/no-js-file-extension` | error | `.js` / `.jsx` source. Use `.ts` / `.tsx` |
| `local/no-raw-undefined-union` | warn | `T \| undefined` in type positions. Use `prop?: T` or a named alias |

Complexity caps (enforced, can't disable): `complexity: 10`, `max-lines: 400`, `max-lines-per-function: 75`, `max-depth: 4`. Refactor with helpers / extracted hooks rather than bumping the thresholds.

## Naming

- Directories: `kebab-case`
- TypeScript utility files: `camelCase.ts`
- React components: `PascalCase.tsx`
- Co-located: `Component.tsx` + `Component.css` + `Component.test.tsx`

## Styling

Plain CSS, co-located per component. No inline styles, no CSS modules, no styled-components.

`src/index.css` defines the token system:

- **Palette**: `--ink-900..500` (surfaces), `--bone-100..500` (text), `--rust-300..700` (brand/action), `--phosphor-400..600` (live/success), `--amber-400..500`, `--crimson-500..600`, `--blueprint-400..600`.
- **Semantic aliases**: `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, etc. Prefer these over raw palette tokens.
- **Scales**: `--s-0..8` (spacing 2→64), `--r-0..2` (radii — stay sharp, this is a console), `--dur-fast/base/slow`, `--ease-snap/out`.
- **Fonts**: `--font-display` (Fraunces), `--font-ui` / `--font-mono` (Berkeley → JetBrains → Plex → system mono). Everything UI is monospace.
- **Layout regions**: `--sidepanel-width`, `--inspector-width`, `--handle-thickness` — unified across views.

Atoms: `.tok` (bracketed status badges, modifiers `.tok-live|warn|danger|info|accent`), `.dot`, `.reg` (register-mark corners), `.btn`, `.kbd`, `.stagger > *`. Layout utilities: `.flex-row`, `.flex-col`, `.gap-2`, `.ml-auto`, `.text-muted`, `.tnum`, `.tracked`, `.truncate`.

Aesthetic: "operator console" — warm ink ground, rust brand, phosphor live signals, monospace UI. Don't slide back toward generic dark-SaaS.

## Code style

- **Comments explain *why*, not *what*.** Well-named identifiers handle "what". Reserve comments for constraints, invariants, workarounds, and non-obvious gotchas.
- **Don't reference the current task** ("added for issue #5", "used by FooView"). Those belong in the PR description, not in code.
- **No error handling for impossible cases.** Trust internal contracts. Validate at system boundaries — HTTP input, AWS responses, user-typed SQL.
- **No abstraction under three concrete uses.** A bug fix is a bug fix, not a refactor.
- **No half-implementation.** A feature spanning shared + proxy + web lands as one PR. Don't commit half-done states.
- **Match existing patterns.** New routes look like existing routes. New views look like existing views. If you're tempted to invent a new shape, ask first.

## Where to add things

| Adding… | Lives in |
|---|---|
| Proxy endpoint | `packages/proxy/src/routes/<topic>.ts` + register in `server.ts`; AWS call in `services/<topic>Service.ts` |
| AWS call | New service in `packages/proxy/src/services/`, called from a route |
| SPA view | `packages/web/src/views/<area>/<View>.tsx` + co-located CSS, register in `routes.tsx` |
| Shared component | `packages/web/src/components/<Component>.tsx` + co-located CSS |
| Hook | `packages/web/src/hooks/<useThing>.ts` |
| Util | `packages/web/src/utils/<name>.ts` + `.test.ts` next to it |
| Shared type | `packages/shared/src/types/<topic>.ts`, re-export from `index.ts` |
| Mock fixture | Extend `packages/web/src/data/mockS3Store.ts` or `mockAthena.ts` |
| Schema-data consumer (dbs/tables/columns) | `useSchema()` from `data/schemaContext.tsx` — never `schemaRepo` directly from QueryView descendants |
| Monaco feature | Register inside `SqlEditorImpl`'s mount effect; dispose in cleanup |
| AWS resource for the demo | `infrastructure/terraform/<topic>.tf` — verbosity preferred over modules |
| Claim-derived AuthContext field | `AlbAuthProvider.resolve()` — derive from a JWT claim, not a lookup table |
| Env var read by the proxy | `config.ts` + `ecs.tf`'s `environment` list |

## Gotchas

Bit-us-during-build items that aren't obvious from grep.

1. **`@athena-shell/shared` is a built package**, not a path alias — its `package.json` main points at `dist/index.js`. Run `pnpm build` (or the watch-mode `dev` script) before the proxy can resolve it. Don't rewrite main to point at `src/index.ts`; that breaks Node's ESM resolver at runtime.
2. **Monaco is lazy-loaded** (~3.3 MB / 856 KB gzipped) via `React.lazy` in `SqlEditor.tsx`. Don't import from `monaco-editor` outside `SqlEditorImpl.tsx` or you'll double the main bundle.
3. **Vite is pinned to `^5.4`** — Vitest 2.x ships a vite 5 peer. Upgrade both or neither.
4. **`pnpm deploy --legacy`** is required (pnpm 10+). The Dockerfile already uses it.
5. **`pnpm.onlyBuiltDependencies: ["esbuild"]`** in the root `package.json` lets esbuild's native binary postinstall run. Don't remove — vite/vitest fail without it.
6. **Data bucket CORS** must allow the internal ALB hostname + expose `ETag`. Set outside this repo (Terraform in the deployment account).
7. **SPA-side prefix checks are UX guardrails.** The IAM role is the actual enforcement. Never trust the SPA for security.
8. **`.flex-row` sets `align-items: center`** — great for toolbars, wrong for layout containers meant to fill vertical space. Override with `align-items: stretch` if you're using it for sidebar+main structure.
9. **Monaco theme + completion provider register globally.** Two mounted editors = duplicate suggestions. The cleanup effect disposes them; don't skip it.
10. **Schema cache is a single context** (`SchemaProvider` / `useSchema()`). Don't call `schemaRepo` directly from QueryView descendants — you'll fork the cache.
11. **ALB `jwt-validation` doesn't inject `x-amzn-oidc-*` headers** without `ClaimsMapping` (aws provider 6.41 doesn't expose it). `AlbAuthProvider` decodes the `Authorization: Bearer` payload directly — no JWKS re-check, ALB already validated.
12. **Authorization codes are single-use.** `CallbackView` guards this with a `useRef` latch + `history.replaceState` to scrub `?code=…`. Preserve both.
13. **Never log raw SQL.** `services/audit.ts`'s `sqlFingerprint()` redacts literals + hashes the shape. Raw SQL is recoverable from Athena's own query history for 45 days if you actually need it.
14. **`replace(name, "/…/", "")` in Terraform is regex mode.** Use `basename()` or `trimprefix()` for path manipulation.
15. **Athena DML rejects backtick-quoted identifiers.** `CREATE VIEW`, `DROP TABLE`, `DROP VIEW`, `SELECT` — all Trino-parsed — use unquoted or double-quoted. `CREATE EXTERNAL TABLE` goes through Hive DDL and accepts backticks.
16. **OpenCSVSerde can't parse `DATE` or `TIMESTAMP`** — only STRING. LazySimpleSerDe is our default for CSV so ISO-8601 dates parse natively; OpenCSVSerde opt-in via the SerDe-mismatch finding.
17. **Don't use AWS Amplify.** The auth module is hand-rolled (PKCE, Identity Pool credential provider, session storage) specifically to avoid it. If someone tries to `pnpm add aws-amplify`, revert.

## Testing

Vitest only. Co-located `*.test.{ts,tsx}` files. What's covered:

- Every `utils/*.ts` (pure functions)
- `localDb.ts` (with `fake-indexeddb`)
- Proxy routes via supertest
- Proxy services with non-trivial shape translation

Not covered: real AWS SDK calls, Monaco render, drag-drop DOM events, React visual snapshots (they rot fast).

Single test file: `cd packages/web && pnpm vitest run src/utils/parseS3Path.test.ts`.

Tier-1 E2E in Playwright: `make e2e` (spins up `pnpm dev` + mock backend, Chromium only).
