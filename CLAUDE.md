# CLAUDE.md

Guidance for Claude Code (and any AI agent) working on athena-shell. **Read this before making changes**, then dig into the docs linked below for any area you're touching.

## What this project is

A web shell over AWS Athena and S3 for users in **VPC-bound / network-restricted environments** — a single SSO login into two surfaces:

1. **Personal Workspace** — drag-drop S3 file management, scoped to the caller's IAM role.
2. **SQL Query Interface** — web "DBeaver for Athena" with schema explorer, Monaco editor, results, history.

Intentionally a **thin shell over AWS APIs**. The IAM role is the fence; we don't reimplement auth / quota / access logic. When you find yourself writing custom permission logic, stop and ask whether IAM / Athena / S3 already provides it.

## Hard constraints (do not violate)

- **No internet egress.** Production runs inside a private VPC. No API Gateway, no CloudFront, no edge runtimes, no SaaS callouts. See [docs/architecture.md](docs/architecture.md#constraints-that-shape-every-decision).
- **Standard tech over novel tech.** Express over Hono. Vite 5 over 6. Mature deps only.
- **Never use AWS Amplify.** The auth module is hand-rolled PKCE + Identity Pool specifically to avoid it. If you see `pnpm add aws-amplify`, revert.
- **Don't half-implement.** Features spanning shared + proxy + web land together, not in pieces.

## How to run

```sh
pnpm install
MOCK_AUTH=1 pnpm dev   # SPA :5173, proxy :8080, no AWS needed
pnpm test              # Vitest across packages
pnpm typecheck
pnpm lint
pnpm build
make ci                # typecheck + lint + test + build
make e2e               # Playwright against pnpm dev
make docker            # production image
```

Shared is a built package, not a path alias. The `dev` script keeps it compiled in watch mode. See [docs/conventions.md](docs/conventions.md#gotchas) gotcha #1 if you hit a resolution error.

## Docs

| Topic | Doc |
|---|---|
| System design, deployment, security | [docs/architecture.md](docs/architecture.md) |
| Auth model, Cognito flow, credential passthrough | [docs/auth.md](docs/auth.md) |
| Proxy endpoints, data flow, repo pattern | [docs/api.md](docs/api.md) |
| Lint rules, naming, style, gotchas, testing | [docs/conventions.md](docs/conventions.md) |
| Audit events + CloudWatch queries | [docs/audit-schema.md](docs/audit-schema.md) |
| Shipped features | [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| Backlog | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Deployment ritual (demo account) | [infrastructure/README.md](infrastructure/README.md) |

## Style in a nutshell

See [docs/conventions.md](docs/conventions.md) for the full version. The rules we break most:

- **Comments explain *why*, not *what*.** Reserve them for constraints, invariants, workarounds. Well-named identifiers handle "what".
- **No error handling for impossible cases.** Validate at system boundaries, trust internal contracts.
- **No abstraction under three concrete uses.** A bug fix is a bug fix, not a refactor.
- **Match existing patterns.** New routes look like existing routes; new views look like existing views. Inventing a new shape? Ask first.
- **Complexity caps are enforced**: `complexity: 10`, `max-lines: 400`, `max-lines-per-function: 75`, `max-depth: 4`. Extract helpers rather than disabling.

## When something fails

- TypeScript errors after adding to `shared`: rebuild with `pnpm --filter @athena-shell/shared build` before re-running typecheck.
- Lint complexity error: extract a helper. Don't bump the threshold.
- `pnpm dev` proxy doesn't see `shared` changes: confirm `pnpm -r --parallel dev` is running and `packages/shared/dist/` is being emitted.
- Docker build fails on `pnpm deploy`: check `--legacy` is still on the deploy line.
- Full list of known gotchas: [docs/conventions.md#gotchas](docs/conventions.md#gotchas).
