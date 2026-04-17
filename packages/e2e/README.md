# athena-shell e2e

Playwright regression tests against `MOCK_AUTH=1` — no AWS SDK, no real data, no Cognito.

## What's covered

Tier-1 cross-component flows that unit tests can't catch:

- `boot.spec.ts` — SPA boots, redirects to `/workspace`, AppShell chrome renders
- `navigation.spec.ts` — nav links swap Workspace ↔ Query views
- `schema-tree.spec.ts` — Catalog expands DB → tables → columns (exercises `SchemaProvider` + `schemaRepo`)
- `query.spec.ts` — default SELECT runs end-to-end, status transitions, results virtualize
- `pagination.spec.ts` — "load more" walks the mock's 3 pages (100 rows each), disappears at exhaustion
- `preview.spec.ts` — text filename opens drawer + ESC closes + non-previewable files don't carry the link affordance
- `create-table.spec.ts` — ⊞ table on a seeded CSV → modal → create → new table visible under `workspace_dev_user` in the schema tree

## Setup

```sh
pnpm install                                      # installs @playwright/test
pnpm --filter @athena-shell/e2e install-browsers  # one-time chromium download (~150 MB)
```

## Run

```sh
make e2e                                          # full suite, headless
# or
pnpm --filter @athena-shell/e2e test
pnpm --filter @athena-shell/e2e test:headed       # watch the browser
pnpm --filter @athena-shell/e2e exec playwright test preview.spec.ts  # one file
```

Playwright boots `pnpm dev` (root) as a managed webServer — waits for :5173, runs tests, tears down. With `reuseExistingServer: true` outside CI, if you already have `MOCK_AUTH=1 pnpm dev` running, tests reuse it instead of spawning a duplicate.

## Why these tests exist

Three recent regressions they would have caught:

1. AuthGate redirect loop during #1 — `boot.spec.ts` asserts the app actually renders content, not a spinner.
2. Schema cache divergence when adding `SchemaProvider` — `schema-tree.spec.ts` exercises the real `useSchema()` flow.
3. Preview drawer double-mount invalidating the auth code — `preview.spec.ts` open-close-open would catch re-entry bugs.

Unit tests can't cover these because they span routing, providers, and real DOM interactions.

## Why not cross-browser?

Internal tool behind an ALB. No Safari / Firefox QA need; chromium is the canonical engine for operator consoles on Linux, Mac, and Windows. If we ever ship a public variant this opens up.

## Not covered (deliberate)

- Monaco autocomplete triggering — tested at the unit level in `sqlCompletions.test.ts` instead
- CSV download button — `resultsToCsv` + `downloadBlob` unit-tested
- Cognito-federated login — requires real Cognito, belongs in a separate integration suite
- Real S3 / Athena / Glue calls — same
- Visual snapshots — intentionally avoided; brittle, high maintenance
