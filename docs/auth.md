# Auth model

Two AuthProvider interfaces (one SPA-side, one proxy-side), each with a mock and a real implementation. Build-time env selects which path runs.

## `AuthContext` — the contract

Everything downstream reads scoping + identity from this shape (`packages/shared/src/types/auth.ts`):

```ts
interface AuthContext {
  userId: string;
  displayName: string;
  email: string;
  region: string;
  roleArn: string;
  s3:     { bucket: string; prefix: string };
  athena: { workgroup: string; outputLocation: string;
            defaultDatabase?: string; userDatabase?: string };
}
```

The SPA reads it from `useAuth().context`. The proxy attaches it to `req.user` via `middleware/authenticate.ts`. **There is no other source of "what the user can do."**

## SPA side — `packages/web/src/auth/`

| File | Role |
|---|---|
| `AuthProvider.ts` | Interface: `getContext`, `getCredentials`, `getProxyAuthHeader`, `isMock`, `signOut` |
| `MockAuthProvider.ts` | Dev path. Repos branch on `isMock() === true` and route to `mockS3Store` / `mockAthena` |
| `CognitoAuthProvider.ts` | Real path. Hand-rolled PKCE (not Amplify, not `oidc-client-ts`). Identity-Pool-minted STS creds for browser-direct S3 via `fromCognitoIdentityPool` |
| `pkce.ts` | `window.crypto.subtle` SHA-256 + base64url |
| `oidcSession.ts` | Tokens in `sessionStorage`; PKCE verifier in a transient store across the redirect |
| `credentialsCache.ts` | 5-minute skew refresh around STS creds so concurrent S3 ops don't fan out N STS calls |
| `provider.ts` | Singleton selected at import time from `VITE_AUTH_PROVIDER`. Throws at load if `cognito` is selected but any of the five required `VITE_COGNITO_*` vars is missing |

## Proxy side — `packages/proxy/src/auth/`

| File | Role |
|---|---|
| `authProvider.ts` | Interface: `resolve(req) → AuthContext` |
| `mockAuthProvider.ts` | Dev path. `X-Mock-User` header → `MOCK_USERS_JSON` lookup |
| `albAuthProvider.ts` | Real path. Decodes `Authorization: Bearer <JWT>` (ALB already validated signature + JWKS + exp). Derives workgroup, S3 prefix, roleArn deterministically from `cognito:username` — **no DynamoDB lookup** |

Env selector: `AUTH_PROVIDER=alb|mock` (default `mock`). `alb` requires five env vars (`AWS_ACCOUNT_ID`, `NAME_PREFIX`, `DATA_BUCKET`, `RESULTS_BUCKET`, `GLUE_DATABASE`) or startup throws.

## Deployed flow

```
SPA load → <AuthGate> → provider.getContext()
  └── no session    → signInRedirect()
       └── /oauth2/authorize w/ PKCE code_challenge
            └── user logs in at Hosted UI
                 └── 302 back to /auth/callback?code=…
                      └── CallbackView completeSignIn(code)
                           └── POST /oauth2/token w/ code_verifier
                                └── ID + access + refresh tokens → sessionStorage
                                     └── navigate to original URL

/api/*  →  Authorization: Bearer <id_token>
          + x-aws-access-key-id / x-aws-secret-access-key / x-aws-session-token
  ALB jwt-validation (iss + JWKS + exp) — forwards on success, 401 on failure
  Proxy AlbAuthProvider decodes the same header, derives AuthContext
  Proxy passthroughCredentials middleware reads the x-aws-* headers, attaches
    them to per-request AWS SDK clients so every Athena/Glue call runs under
    the caller's IAM role

S3 (browser-direct) →
  fromCognitoIdentityPool(idToken) → Identity Pool role mapping
    → per-user IAM role → short-lived STS creds → S3Client
```

## Per-user IAM via credential passthrough

The proxy's task role carries **no app permissions** — only ECR pull + CloudWatch log writes. Every AWS call the proxy issues runs under the caller's STS credentials, forwarded from the browser via three headers (`x-aws-access-key-id`, `x-aws-secret-access-key`, `x-aws-session-token`).

Per-user IAM roles (`infrastructure/terraform/iam-user-roles.tf`) carry the real permissions:

- **S3**: list + RW on `users/<username>/*` in the data bucket; RW on the results bucket's per-user prefix.
- **Athena**: full query lifecycle + named-queries, scoped to the user's own workgroup.
- **Glue**: reads on the shared demo catalog + `workspace_<username>`; writes only on `workspace_<username>`.

A Cognito Identity Pool rule-based mapping (`identity-pool.tf`) dispatches each authenticated user to their dedicated role. The browser gets short-lived STS creds; Athena + Glue see the same principal via the proxy. **IAM is the fence**; app-level prefix checks are UX guardrails, not enforcement.

## Three gates against silent-mock deployment

1. **Fargate task env** hard-codes `AUTH_PROVIDER=alb` + `MOCK_AUTH=0`. Proxy refuses to start without the five `alb`-mode vars.
2. **ALB `jwt-validation`** rejects unauthenticated `/api/*` at the edge.
3. **SPA build** bakes `VITE_AUTH_PROVIDER=cognito`. A mock-mode proxy would 401 every bearer-token request, so the SPA can't silently fall into mock.

## Swapping to Entra SSO

`infrastructure/terraform/cognito.tf` contains a commented `aws_cognito_identity_provider "entra"` block. To federate:

1. Uncomment + populate the metadata URL (SAML) or issuer (OIDC).
2. Add `"Entra"` to `supported_identity_providers` on the app client.
3. Delete `users.tf` (federated users provision on first login).
4. Flip the Identity Pool mapping (in `identity-pool.tf`) from `cognito:username Equals <user>` to `cognito:groups Contains <group>` — per-team roles replace per-user roles.

No code changes on the proxy or SPA — both are claims-based, claim names are stable under federation.
