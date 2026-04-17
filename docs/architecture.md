# athena-shell architecture

The source of truth for how athena-shell is built. For day-to-day conventions and gotchas, see [conventions.md](conventions.md). For the auth model, see [auth.md](auth.md). For the API surface and data flows, see [api.md](api.md).

## Why this exists

Non-technical users in regulated or network-restricted organizations need two things from AWS that the AWS console serves badly:

1. **Move files in and out of S3** — the console's S3 page assumes IAM literacy and offers no concept of "your" workspace.
2. **Run ad-hoc SQL against those files via Athena** — the Athena console exposes workgroups, output locations, and row-limit gotchas that confuse end users.

Free desktop tools like DBeaver solve the SQL UX but **none support Cognito-federated SSO**, which is required when users authenticate via an enterprise IdP (Entra / Okta / etc.). They also assume the user's machine can reach the data, which often isn't true in restricted environments.

athena-shell is a **thin web shell over the AWS APIs that already do the work**. Two design priorities:

- **Almost no business logic.** The IAM role enforces permissions. Workgroups enforce query budgets. We don't reimplement these — we render them.
- **Fits inside a private VPC.** No internet egress, no API Gateway, no edge runtimes. One ECS Fargate task.

## Constraints that shape every decision

### VPC-bound deployment, no internet egress

Production runs inside a private VPC on AWS commercial with no internet egress. This rules out:

- ❌ API Gateway (internet-facing)
- ❌ CloudFront / Cloudflare / edge runtimes
- ❌ Lambda@Edge
- ❌ SaaS reachable only over the public internet
- ❌ Runtime package installs (ECR image pulls go via interface endpoint)

What's left: ECS Fargate behind an internal ALB, AWS service calls via VPC interface/gateway endpoints.

### Standard tech over novel tech

Express over Hono. Vite over Webpack / Bun. AWS SDK v3 (no choice). idb for IndexedDB. Any time you reach for something newer, justify it in writing — security review and contributor onboarding cost more than the marginal feature.

### Thin shell, not a platform

Don't build features AWS already gives us. Bucket policies, IAM roles, workgroup quotas, Athena query history, Glue catalog — these are authoritative. If a feature requires duplicating IAM logic in TypeScript, that's a smell.

## System architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Private VPC                                │
│                                                                     │
│  Browser ─── TLS ───► internal ALB ─── HTTP ───► ECS Fargate task   │
│      │                                            ┌─────────────┐   │
│      │  /api responses                            │  Container  │   │
│      ├◄──────────────────────────────────────────┤             │   │
│      │                                            │  Express    │   │
│      │  /* SPA static assets                      │   /api/*    │   │
│      ├◄──────────────────────────────────────────┤             │   │
│      │                                            │  /* (SPA)   │   │
│      │                                            └─────┬───────┘   │
│      │                                                  │ AWS SDK v3│
│      │                                                  ▼           │
│      │                        VPC interface endpoints                │
│      │                        (Athena, Glue, Logs, ECR, KMS, …)     │
│      │                                                              │
│      │  AWS SDK v3 (browser)                                        │
│      └──────────────────► S3 (gateway endpoint)                     │
└─────────────────────────────────────────────────────────────────────┘
```

Two traffic paths:

1. **SPA → proxy → AWS** for Athena, Glue, and Athena-results presigning. The proxy reads the user's STS credentials from three `x-aws-*` request headers and forwards them into AWS SDK clients — every AWS call runs under the caller's own IAM role.
2. **SPA → S3 directly** for file list / upload / download / delete. Browser holds short-lived STS creds (Cognito Identity Pool), bucket policy + per-user IAM role enforce scope. No proxy round-trip for S3.

**Hybrid AWS access was a first-principles choice.** "Everything through the proxy" was rejected because the proxy would have to assemble multipart uploads in memory and stream multi-GB downloads back to the browser. Not viable for ad-hoc datasets.

### The single-container choice

Both halves — Express proxy and built SPA — ship in one container. Dockerfile copies `packages/web/dist/` into the proxy's `public/`; `serveSpa.ts` mounts it as static + SPA history fallback. One ALB target group, one image, one healthcheck.

Separate-Fargate-task and S3+CloudFront were considered and rejected: deployment surface doubled for a 22 MB asset bundle that never changes independently of the proxy, and CloudFront is internet-facing by default.

### Repo layout

```
athena-shell/
├── packages/
│   ├── shared/        # cross-boundary types (auth, query, schema, s3, datasets)
│   ├── proxy/         # Express server — routes, auth, services, static SPA mount
│   └── web/           # Vite + React SPA — views, data repos, mock stores
├── eslint-rules/      # 6 local custom rules
├── infrastructure/    # Terraform for the demo deployment
├── docker/            # multi-stage Dockerfile
└── docs/              # you are here
```

See [conventions.md](conventions.md) for naming, lint, and style rules.

## Deployment topology

### Container

Multi-stage (`docker/Dockerfile`):

1. **Builder** — `node:20-alpine` + pnpm 10, builds all three packages.
2. **Deploy stage** — `pnpm --filter @athena-shell/proxy --prod --legacy deploy /tmp/deploy` flattens the workspace so a plain `COPY` produces a standalone tree.
3. **Runtime** — `node:20-alpine`, copies `/tmp/deploy` + `packages/web/dist`, runs as non-root `app`, healthcheck on `/api/health`.

Image is dominated by Monaco's lazy chunk (~22 MB in the image; chunked over the wire).

### ECS Fargate task

| Setting | Value |
|---|---|
| Network mode | `awsvpc` (required) |
| CPU / memory | 1 vCPU / 2 GB (start; size up if Athena polling is hot) |
| Container port | 8080 |
| Task role | No app permissions — only ECR pull + CloudWatch log writes. AWS calls run under the caller's passthrough STS creds. See [auth.md](auth.md#per-user-iam-via-credential-passthrough) |
| Execution role | Standard |
| Healthcheck | `GET /api/health` |
| Subnets | Private, no public IP |
| Security group | Inbound from internal ALB SG only |

### Required VPC endpoints

All interface (with private DNS) except S3 which is a gateway endpoint:

| Service | Type |
|---|---|
| S3 | gateway |
| Athena | interface |
| Glue | interface |
| STS | interface |
| CloudWatch Logs | interface |
| ECR API + DKR | interface |
| Secrets Manager, SSM, KMS | interface (as needed) |
| Cognito IDP + Cognito Identity | interface |

Bucket policies restrict to `aws:SourceVpce` matching the S3 endpoint.

### S3 CORS (browser-direct uploads)

```jsonc
{
  "AllowedOrigins": ["https://<internal-alb-hostname>"],
  "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}
```

Without this, browser-side multipart uploads fail at the preflight.

### Multipart abort lifecycle

```jsonc
{
  "ID": "abort-orphan-multipart",
  "Status": "Enabled",
  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
}
```

Without this, tabs closed mid-upload leave billed parts around forever.

## Security model

Layers, outermost to innermost:

1. **Network** — internal-only ALB, security group restricts ingress, no public IP on the task.
2. **Auth** — ALB `jwt-validation` rejects unauthenticated `/api/*` at the edge. Healthcheck is the only unauthenticated route.
3. **Credential passthrough** — every AWS call the proxy makes carries the caller's STS creds. The proxy task role holds nothing.
4. **IAM** — per-user roles (`infrastructure/terraform/iam-user-roles.tf`) bound to what each user can do.
5. **Bucket policy** — `aws:SourceVpce` restriction + block-public-access.
6. **Audit** — structured JSON events per proxy call + CloudTrail data events on S3. See [audit-schema.md](audit-schema.md).

Things to remember:

- **Browser-visible STS creds are not a vulnerability** when scoped tightly and short-lived. They are visible in DevTools — that's expected. The per-user IAM role is what makes them safe.
- **SPA-side prefix checks are UX guardrails.** IAM is the actual enforcement.
- **SQL is user-typed.** Workgroup `bytes_scanned_cutoff` is the safety net for accidental full-table scans.
- **CSV download is presigned direct-to-S3** so multi-GB results don't pass through proxy memory.

## Decisions log

Non-obvious choices, in case you wonder why:

| Decision | Rationale |
|---|---|
| Hybrid AWS access (S3 direct, Athena via proxy) | Multi-GB browser↔S3 transfers can't go through proxy memory. Athena/Glue go through the proxy so workgroup config and result presigning live in one place. |
| Single Fargate task serving SPA + API | VPC-bound deployments forbid CloudFront. S3+ALB-static was considered — more plumbing for no real benefit. |
| Credential passthrough instead of per-request AssumeRoleWithWebIdentity | Simpler: the browser already holds STS creds from the Identity Pool; we forward them instead of re-minting. One source of truth for the caller's IAM identity across all AWS calls. |
| Unified shell — `/workspace` + `/query` are URL aliases, not separate views | Tabs differentiate content kind (SQL vs. browser). One chrome, one tab strip, one sidebar. Routes just seed the right tab kind on mount. |
| Express, not Hono / Fastify | Mature, widely understood — easier for security review and contributor onboarding. |
| Monaco, not CodeMirror | Matches DBeaver polish users expect. Bundle penalty acceptable because lazy-loaded. |
| Plain CSS, not CSS modules / styled-components | Simpler bundle, simpler debugging, no runtime dep. |
| pnpm workspaces, not turbo / nx | Three packages don't justify a build orchestrator. |
| Vite 5, not 6 | Vitest 2.x ships vite 5; mixing breaks plugin types. |
| Mock everything in dev | Contributors may lack AWS sandbox access (common in restricted-network shops). The mock layer is intentional. |
| IndexedDB for tabs + favorites | Local state survives Athena's 45-day retention. No backend state to manage. |
| `AuthProvider` interface from day one | Cognito was deferred past v1; the abstraction shipped the shell while it was deferred, and the demo auth later dropped in cleanly. |
| LazySimpleSerDe as the CSV default | OpenCSVSerde can't parse native DATE/TIMESTAMP — requires UNIX numeric form. LazySimple handles ISO dates out of the box. OpenCSVSerde is opt-in for CSVs with quoted-delimiter fields. |
| react-resizable-panels v2 | Canonical `PanelGroup` / `Panel` / `PanelResizeHandle` API; v4 changed both names and semantics, and we value the larger tutorial / Q&A surface that v2 has. |
