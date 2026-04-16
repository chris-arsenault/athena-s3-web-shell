# athena-shell

A web shell over AWS Athena and S3 for non-technical federal users — a single SSO-protected app that combines drag-and-drop S3 file management with a friendly SQL interface for querying that data through Athena.

It is intentionally a **thin shell over AWS APIs**. Almost no custom business logic; the IAM role does the access control. The differentiator vs. existing free SQL tools is integrated SSO (Cognito federated by Entra ID) and a UX shaped for non-technical users.

## What's in the box

| Feature | Status (v1) |
|---|---|
| Personal Workspace — drag-drop S3 file browser, multipart upload, folder upload, download, delete | ✅ |
| SQL Query Interface — Monaco editor, schema explorer, results, history, favorites, CSV download | ✅ |
| `AuthProvider` abstraction with `MockAuthProvider` for offline dev | ✅ |
| Cognito + Entra ID auth, AssumeRoleWithWebIdentity per request | 🚧 [#1](https://github.com/chris-arsenault/athena-s3-web-shell/issues/1), [#2](https://github.com/chris-arsenault/athena-s3-web-shell/issues/2) |
| Audit logging, result streaming, S3→Athena table automation | 🚧 [#3](https://github.com/chris-arsenault/athena-s3-web-shell/issues/3), [#4](https://github.com/chris-arsenault/athena-s3-web-shell/issues/4), [#5](https://github.com/chris-arsenault/athena-s3-web-shell/issues/5) |

## Architecture at a glance

```
                 ┌─────────────────────────────────────────────────┐
                 │              Federal enclave VPC                │
                 │                                                 │
  Browser ──TLS──┤  internal ALB                                   │
                 │      │                                          │
                 │      ▼                                          │
                 │  ECS Fargate task (one container)               │
                 │  ┌────────────────────────────────────────┐     │
                 │  │ Express proxy                          │     │
                 │  │   /api/*  → Athena, Glue, STS          │ ──► VPC endpoints
                 │  │   /*      → built SPA static assets    │     │
                 │  └────────────────────────────────────────┘     │
                 │                                                 │
                 │  S3 (data bucket, Athena results bucket)        │ ◄── browser-direct uploads/downloads
                 └─────────────────────────────────────────────────┘     using STS temp creds
```

Hybrid AWS access: the **browser talks to S3 directly** with short-lived Cognito-issued credentials (scales without proxy bottleneck), and the proxy handles **Athena/Glue** so workgroup/output-location enforcement and result presigning live in one trusted place. Both halves run in the same Fargate task so there is one image to deploy and no separate CDN — required because the federal enclave has no internet egress, no API Gateway, and no CloudFront.

For the full picture see [docs/architecture.md](docs/architecture.md).

## Quick start

```sh
pnpm install
MOCK_AUTH=1 pnpm dev
```

- SPA: http://localhost:5173
- Proxy: http://localhost:8080 (Vite proxies `/api/*`)

`MOCK_AUTH=1` activates `MockAuthProvider` (web) and the `X-Mock-User` middleware (proxy) plus an in-memory S3+Athena fake. The whole app is functional end-to-end with **no AWS credentials**.

## Production image

```sh
make docker          # build athena-shell:dev
make docker-run      # run on :8080 with MOCK_AUTH=1
```

The single container serves both `/api/*` (Express) and `/*` (built SPA static assets) — drop it on ECS Fargate behind an internal ALB.

## Layout

```
athena-shell/
├── packages/
│   ├── shared/      # types shared between web + proxy (auth, query, schema, s3)
│   ├── proxy/       # Express server: routes, auth, AWS SDK wrappers, SPA static serve
│   └── web/         # Vite + React SPA
├── eslint-rules/    # local custom rules (mirroring ../ahara-standards)
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
| `pnpm format` | Prettier write |
| `make docker` / `make docker-run` | Build and run the production image |

## Documentation

| Doc | What's in it |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System design, request flows, deployment topology, security model, extension points |
| [CLAUDE.md](CLAUDE.md) | Guidance for Claude Code agents — conventions, gotchas, lint rules, scope |
| [LICENSE](LICENSE) | MIT |

## Standards

Lint, code style, and project structure mirror [ahara-standards](https://github.com/) **conventions** without depending on the `@ahara/*` packages. The custom lint rules live in [`eslint-rules/`](eslint-rules/) — see [CLAUDE.md](CLAUDE.md#lint-rules-to-know) for details.

## License

MIT — see [LICENSE](LICENSE).
