# Post-deploy polish

The full auth flow is live — proxy + SPA + ALB + Cognito all wired. This file tracks the remaining polish items. Nothing here is blocking a working demo.

---

## Token refresh

Access/ID tokens are configured for 60-minute lifetime on the Cognito client. When they expire, the next `/api/*` call returns 401 via ALB; the SPA catches that and triggers a full Hosted-UI round-trip. It works, but it's abrupt — the user loses their in-app state.

Smoother: when `isExpired(session)` is about to be true, silently exchange the stored `refresh_token` at `/oauth2/token` (`grant_type=refresh_token`) and update `sessionStorage` without navigating. Scope: one new method on `CognitoAuthProvider` (`refresh()`), called proactively from `getProxyAuthHeader()` and `requireSession()` when expiry is < 5 min away.

## Signed-out landing page

`provider.signOut()` redirects to Cognito `/logout`, which returns to `https://shell.ahara.io/`. Whatever route loads there immediately triggers a fresh sign-in redirect — so "logout" visibly snaps back into "logged in" if the Cognito session is still warm, or silently loops through auth before showing anything.

A dedicated `/signed-out` route with a "Sign in again" CTA breaks the loop for deliberate logouts. Scope: one new route + component; `signOut()` navigates to `/signed-out` instead of triggering the Cognito logout redirect directly (or does both, clearing Cognito's session server-side while the SPA shows the CTA).

## Entra federation

The demo uses direct Cognito users (`test_athena_{1,2,3}`). Promoting to real SSO means:
- Uncomment the `aws_cognito_identity_provider "entra"` block in `cognito.tf` and populate with a real SAML metadata URL or OIDC issuer.
- Add `"Entra"` to `supported_identity_providers` on the app client.
- Delete `users.tf` (federated users are provisioned on first login).
- Switch the Identity Pool rule-based mapping from `cognito:username Equals <user>` to a group-claim rule (see the inline comment in `identity-pool.tf`).

No code changes needed on either the proxy or SPA — their contracts are claims-based and claim names don't change under federation.

## End-to-end smoke test

Log in as each of `test_athena_{1,2,3}`, verify:
- Hosted UI redirect → callback → navigated into the workspace.
- `/api/session` returns that user's identity, not the mock.
- Workspace shows only `users/<username>/`.
- Query runs under `athena-shell-<username>` workgroup; results land in `s3://…-results/users/<username>/`.
- Switch users via incognito windows; no cross-visibility.

## Audit + observability

`pino`-based audit logging for query/S3 operations is tracked in #3; no work here beyond what that ticket covers.

---

## When to delete this file

Once token refresh and the signed-out landing are in place and the end-to-end smoke has been run against all three test users, delete this file. Entra federation work, if it happens, gets its own ticket.
