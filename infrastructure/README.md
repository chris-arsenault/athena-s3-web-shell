# athena-shell infrastructure

Terraform for the demo deployment into an ahara-platform AWS account.

**This is demo scaffolding.** It intentionally reuses ahara's Cognito User Pool, ALB, and VPC while standing up its own S3, Athena, Glue, DynamoDB, Fargate, and Cognito Identity Pool. It deliberately avoids the `ahara-tf-patterns` modules — resources are spelled out in full so the SSO replacement points are readable in-file.

## What it provisions

| Concern | Resource |
|---|---|
| **Auth** | Cognito app client (Hosted UI + PKCE) in the shared `ahara-users` pool; Cognito Identity Pool; 3 Cognito users `test_athena_{1,2,3}`; 3 per-user IAM roles + 1 fallback |
| **Data** | S3 data bucket `athena-shell-data-<acct>` (CORS for `shell.ahara.io`, per-user `users/<name>/` prefixes); S3 results bucket `athena-shell-results-<acct>`; Glue database; 3 per-user Athena workgroups |
| **Compute** | ECR repo; Fargate cluster + task def + service (in ahara private subnets); CloudWatch log group; task security group |
| **Routing** | ACM cert for `shell.ahara.io`; two listener rules (priorities 220-221) on the shared ahara ALB; Route53 A-ALIAS record |

Per-user workgroup + S3 prefix are **derived deterministically** from the `cognito:username` claim in the JWT (see `AlbAuthProvider`) — no lookup table. The only authoritative mapping is the resource-name ↔ username convention itself.

## Architecture summary

```
  Browser ─── HTTPS ──► shell.ahara.io ──► ahara ALB ──► Fargate proxy
     │                                        │           (handles /api/query, /api/schema, /api/history)
     │                                        │
     │                            jwt-validation (priority 220, /api/*)
     │                            forward     (priority 221, /*)
     │
     │─── Cognito Hosted UI + PKCE ──► Cognito User Pool (ahara-users)
     │                                          │
     │─── GetCredentialsForIdentity ──► Cognito Identity Pool (ours)
     │                                          │ rule-based mapping
     │                                          ▼
     │                                per-user IAM role
     │                                          │
     └───── @aws-sdk/client-s3 ──► S3 data bucket (users/<name>/ only)
```

The proxy **never handles STS**. Per-user S3 scoping is enforced by the Identity Pool + per-user IAM role policies. The proxy uses its own task role for Athena/Glue — per-user Athena scoping comes from picking the right workgroup, which it derives from the `cognito:username` claim using a fixed naming convention.

## SSO replacement points

Every line in this stack that would change when federating to Entra ID is marked with a `# FUTURE (SSO): ...` comment. Highlights:

- `cognito.tf` — `supported_identity_providers` gains `"Entra"`; new `aws_cognito_identity_provider` resource block (SAML or OIDC) is commented out below, ready to uncomment.
- `users.tf` — entire file goes away. Users provisioned by Entra on first login.
- `identity-pool.tf` — rule-based mapping switches from `cognito:username Equals <user>` to `cognito:groups Contains <group>`.
- `iam-user-roles.tf` — `for_each` on `local.user_set` becomes `for_each` on a team/group set.
- `athena.tf` — per-user workgroups become per-team workgroups.
- `iam-proxy.tf` — Athena resource arns widen from per-user to a pattern over team workgroups.
- `AlbAuthProvider` — the deterministic derivation (`username → workgroup`) becomes a group-based derivation (`cognito:groups[0] → workgroup`). If the group→workgroup relationship becomes non-trivial, introduce a small SSM-backed lookup here (not DynamoDB — SSM Parameter Store is the idiomatic choice for low-write, high-read config in ahara).

## How to deploy

### Prerequisites

- An AWS identity (role/user) active in your shell with Terraform-apply scope + ECR push + ECS update-service on athena-shell resources, plus read/write on the state bucket.
- `terraform >= 1.12`, `docker`, `aws` CLI v2, `jq` (optional for output parsing).

### First deploy

```sh
./scripts/deploy.sh
```

This does a terraform apply, docker build + push to ECR, and a force-new-deployment on the ECS service. On first run Fargate will briefly fail to pull the image (because ECR is empty when TF creates the service); the script pushes the image and forces a redeploy. Second cycle is clean.

**After `./scripts/deploy.sh` finishes, one more step is required on first deploy only:**

```sh
cd /home/tsonu/src/ahara-infra/infrastructure/terraform && terraform apply
```

This is because ahara-infra's terraform regenerates the pre-auth Lambda's `/ahara/auth-trigger/client-map` parameter by scanning `/ahara/auth-trigger/clients/*` on every apply. Our apply writes `/ahara/auth-trigger/clients/athena-shell` but doesn't touch the consolidated map. Without this step, login fails with `PreAuthentication failed ... Unknown application: <clientId>`. Warm Lambda containers cache the map for up to ~15 min, so if you log in immediately after propagation, you may still see the error for a moment.

This step is **not** needed for subsequent deploys unless the Cognito client is recreated.

### Subsequent deploys (app-code changes only)

```sh
./scripts/deploy.sh
```

Same command — Terraform is fast when nothing infra-side changed; the image push + ECS redeploy carries the new bits.

## Getting test user credentials

```sh
cd infrastructure/terraform
terraform output -json test_users
terraform output -json test_user_passwords
```

Passwords are `sensitive` outputs — they won't print by default, only via `-json` or `-raw test_user_passwords`.

## Teardown

```sh
cd infrastructure/terraform
terraform destroy
```

Notes:
- The shared ALB, VPC, and User Pool are not owned by this stack — `destroy` only removes what was created here (listener rules, target group, ACM cert, Route53 record, Cognito app client + identity pool, IAM roles, S3 buckets, Athena workgroups, Glue DB, DynamoDB, ECS cluster, ECR repo).
- S3 buckets have `force_destroy = false` by default. If you've uploaded objects, empty them first or flip `force_destroy = true` on the bucket resources.
- ECR repo has `force_delete = true` so images are wiped on destroy.

## What's deployed

The proxy + SPA app code needed to run against this IaC is **already in the repo**:

- `packages/proxy/src/auth/albAuthProvider.ts` + `src/data/userMappingsRepo.ts` — reads ALB-injected OIDC headers, looks up the user's workgroup + prefix from DynamoDB.
- `packages/web/src/auth/CognitoAuthProvider.ts` (+ `pkce.ts`, `oidcSession.ts`) — raw PKCE against Cognito Hosted UI (no Amplify, no `oidc-client-ts`), `fromCognitoIdentityPool` for browser-direct S3 creds.
- `packages/web/src/auth/provider.ts` — build-time selection via `VITE_AUTH_PROVIDER` (deploy script sets to `cognito`).
- `packages/web/src/views/auth/CallbackView.tsx` + `/auth/callback` route — completes the OIDC code exchange.
- `docker/Dockerfile` — accepts the `VITE_AUTH_PROVIDER` + 5 `VITE_COGNITO_*` build args so the SPA bundle is baked with the right config.

Remaining post-deploy polish items (token refresh, signed-out UX, Entra federation) live in [`../docs/ROADMAP.md`](../docs/ROADMAP.md) §E.

## Defense-in-depth against silent-mock deployment

Three independent gates ensure a live deploy can't silently use mock auth:

1. **Fargate task env** (`ecs.tf`) hard-codes `AUTH_PROVIDER=alb` + `MOCK_AUTH=0`. Proxy refuses to start without the four alb settings.
2. **ALB `jwt-validation` action** (`alb.tf`) rejects unauthenticated `/api/*` at the edge — a mock-mode SPA has no bearer token to send.
3. **SPA build** — deploy script passes `VITE_AUTH_PROVIDER=cognito`. The SPA sends bearer tokens; a mock proxy (which expects `X-Mock-User`) would 401 every request and the SPA would loop back to Hosted UI.

All three would have to be actively subverted to ship a silent-mock build.

## File layout

```
infrastructure/terraform/
  versions.tf          Terraform/provider versions + S3 backend
  main.tf              Provider config + default tags
  variables.tf         Inputs (region, prefix, hostname, user list, listener priorities)
  locals.tf            Computed locals (SSM-sourced Cognito refs, account ID)
  data.tf              Platform discovery (VPC, ALB, Cognito SSM, Route53 zone)
  cognito.tf           App client + commented Entra IdP block
  users.tf             Test users + random passwords  (DELETE on SSO)
  identity-pool.tf     Identity Pool + role mappings
  iam-user-roles.tf    Per-user IAM roles + fallback role
  iam-proxy.tf         Proxy task + execution roles
  s3.tf                Data + results buckets
  athena.tf            Per-user workgroups + shared Glue DB
  ecr.tf               Container registry
  ecs.tf               Cluster + task def + service + SG + logs
  alb.tf               ACM cert + target group + listener rules
  route53.tf           A-ALIAS for shell.ahara.io
  outputs.tf           Everything the deploy script + operator needs
```
