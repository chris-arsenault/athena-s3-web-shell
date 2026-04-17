# athena-shell

A web shell over AWS Athena and S3 designed for **VPC-bound deployments** — environments where the app must run entirely inside a private network with no internet egress, no API Gateway, no edge CDN. Combines drag-and-drop S3 file management with a friendly SQL interface for querying that data through Athena, all behind a single SSO login.

Intentionally a **thin shell over AWS APIs**. Almost no custom business logic — the IAM role does the access control. The differentiator vs. existing free SQL tools is integrated SSO (Cognito federated by Entra ID) and a shape that fits inside network-restricted environments where DBeaver and similar desktop tools can't authenticate or reach the data.

## Why this exists

Plenty of mature SQL tools work great against Athena — until your environment requires that:

- The app runs entirely inside a VPC with no public internet access
- Auth must integrate with an enterprise IdP (Entra / Okta / etc.) via Cognito federation
- Users see their *own* scoped S3 prefix, not the whole bucket
- The deployment can't depend on API Gateway, CloudFront, or any third-party SaaS

Industries that hit this constellation regularly: regulated finance, healthcare, defense, aerospace, public sector — anything with a security review that frowns on data leaving a VPC. If that's you, this project may save you reinventing the same shell.

## Architecture at a glance

```
                 ┌─────────────────────────────────────────────────┐
                 │                Private VPC                      │
                 │                                                 │
  Browser ──TLS──┤  internal ALB  (Cognito JWT validation)         │
                 │      │                                          │
                 │      ▼                                          │
                 │  ECS Fargate task (one container)               │
                 │  ┌────────────────────────────────────────┐     │
                 │  │ Express proxy                          │     │
                 │  │   /api/*  → Athena, Glue (STS creds    │ ──► VPC endpoints
                 │  │              passed from browser)      │     │
                 │  │   /*      → built SPA static assets    │     │
                 │  └────────────────────────────────────────┘     │
                 │                                                 │
                 │  S3 (data bucket, Athena results bucket)        │ ◄── browser-direct ops
                 └─────────────────────────────────────────────────┘     using STS temp creds
```

Hybrid AWS access: the **browser talks to S3 directly** with short-lived Cognito-Identity-Pool credentials, and the **proxy handles Athena/Glue** with those same per-user creds forwarded as headers. One container, one image, no edge CDN. Full picture in [docs/architecture.md](docs/architecture.md).

## Quick start

```sh
pnpm install
MOCK_AUTH=1 pnpm dev
```

- SPA: http://localhost:5173
- Proxy: http://localhost:8080 (Vite proxies `/api/*`)

`MOCK_AUTH=1` activates the mock auth provider plus an in-memory S3+Athena fake. The whole app is functional end-to-end with **no AWS credentials**.

## Production image

```sh
make docker          # build athena-shell:dev
make docker-run      # run on :8080 with MOCK_AUTH=1
```

One container serves both `/api/*` (Express) and `/*` (built SPA) — drop it on ECS Fargate behind an internal ALB.

## Layout

```
athena-shell/
├── packages/
│   ├── shared/      # types shared between web + proxy
│   ├── proxy/       # Express server: routes, auth, AWS SDK wrappers, SPA static serve
│   └── web/         # Vite + React SPA
├── eslint-rules/    # local custom rules
├── infrastructure/  # Terraform for the demo deployment
├── docker/
└── docs/
```

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run web + proxy in parallel with hot reload |
| `pnpm build` | Build SPA `dist/` and compile proxy |
| `pnpm lint` | Lint everything (ESLint flat config v9) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Vitest across packages |
| `make ci` | typecheck + lint + test + build |
| `make e2e` | Playwright suite against `pnpm dev` |
| `make docker` / `make docker-run` | Build and run the production image |

## Documentation

| Topic | Doc |
|---|---|
| System design, deployment, security model | [docs/architecture.md](docs/architecture.md) |
| Auth model, Cognito flow, credential passthrough | [docs/auth.md](docs/auth.md) |
| Proxy endpoints, data flow, repo pattern | [docs/api.md](docs/api.md) |
| Lint rules, naming, style, gotchas, testing | [docs/conventions.md](docs/conventions.md) |
| Audit event schema + CloudWatch queries | [docs/audit-schema.md](docs/audit-schema.md) |
| Shipped features | [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| Backlog | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Deployment ritual (demo account) | [infrastructure/README.md](infrastructure/README.md) |
| Guidance for Claude Code / AI agents | [CLAUDE.md](CLAUDE.md) |

## License

MIT — see [LICENSE](LICENSE).
