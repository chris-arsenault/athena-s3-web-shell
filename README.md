# athena-shell

Web shell over AWS Athena and S3 for non-technical federal users.

## Quick start

```sh
pnpm install
MOCK_AUTH=1 pnpm dev
```

- SPA: http://localhost:5173
- Proxy: http://localhost:8080 (Vite proxies `/api/*`)

`MOCK_AUTH=1` enables a `MockAuthProvider` so the app works end-to-end without AWS credentials.

## Layout

- `packages/web` — Vite + React SPA
- `packages/proxy` — Express proxy for Athena/Glue
- `packages/shared` — types shared across the boundary

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run web + proxy in parallel with hot reload |
| `pnpm build` | Build SPA `dist/` and compile proxy |
| `pnpm lint` | Lint everything (ESLint flat config v9) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Vitest across packages |
| `make docker` / `make docker-run` | Build and run the production image locally |

See `/home/tsonu/.claude/plans/we-re-going-to-build-scalable-pearl.md` for the full implementation plan.
