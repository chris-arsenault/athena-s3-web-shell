# Changelog

User-facing features shipped on `main`. UI redesigns, internal refactors, bug fixes, and test-infra are out of scope here — see `git log` for those. Companion to [docs/ROADMAP.md](docs/ROADMAP.md) which tracks work still to come.

## Unreleased

### Data layer

- **Interactive CreateTable review** ([#18]) — two-stage modal with a location decision tree (move outside-`/datasets/` sources into `/datasets/<table>/`; in-place for clean dataset subfolders; hard-block on mixed parent or duplicate table) plus DDL-only hygiene findings. Strict type detection auto-flags columns with regex-valid-but-semantically-broken values (e.g. `2024-00-31`, past-`MAX_SAFE_INTEGER` ints). LazySimpleSerDe default for CSV — native ISO date/timestamp parsing. Companion `TRY_CAST` view emitted for STRING-overridden columns.
- **Per-user credential passthrough** — Athena/Glue calls now run under the caller's STS creds (Cognito Identity Pool) instead of a shared proxy task role. Audit logs + CloudTrail show the real user principal.
- **Direct-from-S3 result fetch** ([#15]) — `load more` past page 1 fetches the full CSV from S3 via a presigned URL, bypassing Athena's paginated `GetQueryResults`. 50–100× faster for large result sets.
- **JSON + Parquet schema inference in CreateTable** ([#16]) — previously only CSV/TSV inferred; JSON/JSONL/Parquet fall through to byte-range sampling and Parquet footer metadata.

### Query editor

- **Multi-tab SQL editor** ([#10]) — per-tab SQL buffer, history link, IndexedDB-persisted across reloads. Scratchpad tabs carry their S3 source so `Cmd+S` writes back.
- **Multi-statement execution** ([#7]) — run statement under cursor (`Cmd+Enter`), all statements (`Cmd+Shift+Enter`), or a selection. Queue panel surfaces per-statement state; stop-on-failure toggle.
- **Workgroup-backed saved queries** ([#9]) — named queries sit in the user's Athena workgroup via `CreateNamedQuery`, accessible across tabs + sessions.
- **Personal SQL scratchpad files** ([#14]) — `.sql` files under the user's S3 prefix, opened as dedicated tabs with a dirty marker and `Cmd+S` write-back (optimistic-concurrency via ETag).
- **Schema-aware SQL autocomplete** — Monaco completion provider keyed on the catalog (databases → tables → columns). Qualifier-aware: `table.` suggests columns; unqualified suggestions include dbs, tables, columns, and keywords.
- **Workspace ↔ query crosslinks** ([#12]) — each table row in the catalog has a `⬈` jump to the underlying S3 prefix in the workspace; each workspace file that backs a known table has a `⌕` jump back into the query editor with a prefilled `SELECT *`.

### Results

- **Virtualized results table + cursor load-more** ([#4]) — react-virtuoso renders only visible rows; "load more" uses Athena's `NextToken` then collapses to S3-direct once past page 1. Rows in memory capped at 100k.
- **In-results filter and group-by panel** ([#8]) — client-side filter chips per column; group-by panel with sum/avg/min/max/count aggregations. Operates on the rows already in the browser.
- **Save query result into workspace** ([#11]) — persists the Athena result CSV into the caller's `users/<username>/…` prefix, optionally with a `.sql` sidecar.

### Workspace

- **Create Athena tables from workspace files** ([#5]) — right-click / toolbar action on CSV, TSV, JSON, JSONL, Parquet opens the CreateTable modal with inferred schema; submits via `CREATE EXTERNAL TABLE`.
- **File preview**: text ([#6]), image, CSV/JSONL as a table, JSON as a tree, Parquet via metadata ([#13]) — all lazy-loaded.

### Auth

- **Cognito Hosted UI + Identity Pool** — hand-rolled PKCE flow (no Amplify). ALB `jwt-validation` enforces at the edge; proxy derives scoping claims from the ID token. Browser-direct S3 uses short-lived STS creds vended by the Identity Pool.
- **Silent Cognito token refresh** ([#17]) — proactively exchanges the refresh token near expiry, so 60-minute sessions don't trigger a Hosted-UI round-trip that drops in-app state.

### Compliance

- **Structured audit logging** ([#3]) — proxy emits JSON-line audit events for every Athena / Glue / datasets call (with SQL fingerprint + hash; no raw SQL). CloudTrail data events capture browser-direct S3. Both are joinable by request id. Schema and queries: [docs/audit-schema.md](docs/audit-schema.md).

---

[#3]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/3
[#4]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/4
[#5]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/5
[#6]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/6
[#7]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/7
[#8]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/8
[#9]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/9
[#10]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/10
[#11]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/11
[#12]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/12
[#13]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/13
[#14]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/14
[#15]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/15
[#16]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/16
[#17]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/17
[#18]: https://github.com/chris-arsenault/athena-s3-web-shell/issues/18
