# Roadmap

Working backlog for athena-shell — only items *not yet built*. See [closed issues](https://github.com/chris-arsenault/athena-s3-web-shell/issues?q=is%3Aissue+state%3Aclosed) for shipped work.

## Where we stand today

- **Auth**: Cognito Hosted UI + Identity Pool; per-user IAM; browser-direct S3; ALB-validated JWT.
- **Editor**: multi-tab with IndexedDB persistence; schema-aware autocomplete; multi-statement exec (under cursor / all / selection); workgroup-backed named queries; scratchpad `.sql` files under the user's prefix.
- **Results**: virtualized table (10k cap) with cursor pagination, in-results filter + group-by panel, CSV download, save-to-workspace (CSV + optional SQL sidecar).
- **Workspace**: browse / upload / download / delete / mkdir; preview for text / image / CSV / JSONL / JSON-tree / Parquet-metadata; CreateTable from CSV/TSV/JSON/JSONL/Parquet.
- **Audit**: pino structured events + SQL fingerprinting; CloudTrail data events on data + results buckets.

---

## A. Query editor

| P | Item | Size | Ticket |
|---|---|---|---|
| P1 | **EXPLAIN + scanned-bytes preview** — inline "preview scan" button issues `EXPLAIN ANALYZE` (or `EXPLAIN` when free) before committing to the full run. Cost-surprise is the #1 Athena complaint outside the console-UX bucket. | M | new |
| P1 | **Cmd-K command palette** — fuzzy search across saved queries, open tabs, scratchpad files, schema tables/columns, workspace files, recent queries. `ufuzzy`, no new deps. | M | new |
| P2 | **Hex-style chained queries** — `@previous_query` or `@<name>` inlined as a CTE at parse time. Schema autocomplete is groundwork. Prototype single-tab first. | M | new |
| P3 | **Query bookmarklets in URL** — encode SQL + database in the URL hash for VPC-internal sharing (Slack/Confluence). Pure SPA. | S | new |

## B. Results: fetch, shape, export

| P | Item | Size | Ticket |
|---|---|---|---|
| P0 | **Direct-from-S3 result fetch** — once "load more" crosses a threshold, bypass `GetQueryResults` and fetch the result CSV straight from S3 (presigned). PyAthena #46 / athena-cli #30 / Redash document 50–100× speedup. Also unblocks lifting the 10k row cap. | M | new |
| P2 | **Query history filters** — status / scanned-bytes range / SQL substring / date. Pure SPA filter over `/api/history`. | S | new |
| P2 | **"Recent" home dashboard** — recent queries + recent files + recent tables, replaces the blank nav shell on login. | M | new |

## C. Workspace

| P | Item | Size | Ticket |
|---|---|---|---|
| P1 | **Resumable uploads + transfer-queue tray** — `lib-storage` Upload already supports it; surface a paused-uploads tray, persist part state in IndexedDB. #1 ask in Cyberduck/CloudBerry forums. | L | new |
| P2 | **Monaco syntax highlighting in preview** (deferred from #6) — `.sql`/`.py`/`.ts`/`.yml` code files get full highlighting in the preview drawer. Lazy-loaded via `React.lazy` (same pattern as `SqlEditor.tsx`) so Monaco doesn't ship on the workspace route unless a code file is opened. | S | new |
| P2 | **S3 versioning UI** — "show versions" + "restore" right-click when the bucket has versioning on. Pure `ListObjectVersions` + `GetObject(versionId)`. | M | new |
| P2 | **Copy `s3://` URI / presigned URL** — right-click in workspace listing. | S | new |
| P2 | **Storage class column** — sortable column in workspace listing. | XS | new |
| P3 | **Drag-out-to-desktop** — `FileSystemHandle` (Chromium). | S | new |
| P3 | **Load next 1 MB in file preview** (deferred from #6) — truncation banner currently just says "download for full file"; add a button to fetch the next 1 MB via ranged GET. | XS | new |

## D. Workspace ↔ query integration

| P | Item | Size | Ticket |
|---|---|---|---|
| P0 | **Workspace ↔ query crosslinks** — schema panel shows `[⇡]` for tables whose `LOCATION` is in the user's prefix (→ workspace); workspace files that back a known table show `[⌕]` (→ query with prefilled `SELECT *`). Pure client-side join. Demo-critical: makes the "two features under one SSO" architecture a felt benefit instead of a stated one. | M | [#12](https://github.com/chris-arsenault/athena-s3-web-shell/issues/12) |
| P0 | **JSON/Parquet schema inference in CreateTable** (from closed #5) — JSONL key-union sniff; Parquet footer via the `hyparquet` reader we already added for preview. Today they fall through to hand-define-columns. Demo-critical: the "drop a file, register it" story shouldn't collapse on the formats everyone actually uses. | S | new |
| P1 | **Folder-level CREATE TABLE** (from closed #5) — register a folder of homogeneous files as one partitioned table. Handle mixed-schema detection + Hive partition paths. | M | new |
| P2 | **Auto-add partitions on upload** (from closed #5) — when a user uploads to a path matching an existing table's partition scheme, offer one-click `ALTER TABLE ADD PARTITION` / `MSCK REPAIR TABLE`. | M | new |
| P2 | **Glue Crawler integration** (from closed #5) — for large/partitioned datasets where manual schema entry doesn't scale; role scoped to the user's prefix. | L | new |
| P2 | **Streamed file transforms via Lambda** — right-click menu on files outside `/datasets/` offering async compute-based conversions (JSON array → JSONL, BOM strip, Excel quoting normalization, encoding conversion, ragged-row drop). Runs as a VPC Lambda under the caller's STS creds, writes output to `/datasets/pending/<table>/`, reports progress via a job-state endpoint. Moved out of #18 because the DDL-only hygiene covers the common cases; keep this scoped to genuine file-rewrite needs. | L | new |
| P3 | **CREATE OR REPLACE TABLE** (from closed #5) — today re-registration is a no-op (`IF NOT EXISTS`); add explicit replace with confirmation for schema evolution. | S | new |

## E. Auth, sessions, identity

| P | Item | Size | Ticket |
|---|---|---|---|
| P0 | **Silent token refresh** — proactively exchange refresh_token at `/oauth2/token` when expiry <5 min away, so expired tokens don't trigger a full Hosted-UI round-trip that drops in-app state. Demo-critical: the current 60-minute expiry means a live demo can visibly lose state mid-session. | S | new |
| P1 | **Signed-out landing page** — `/signed-out` route with "Sign in again" CTA, so `signOut()` doesn't visibly snap back into "logged in" when the Cognito session is still warm. | XS | new |
| P2 | **Entra federation promotion** (from closed #1) — uncomment `aws_cognito_identity_provider "entra"` in `cognito.tf`, swap Identity Pool rule from username-equals to group-claim, delete `users.tf`. No app code change — claim-based contracts are federation-neutral. Gate on a real customer with IdP credentials. | M (infra) | new (when needed) |

## F. Audit, observability, compliance

| P | Item | Size | Ticket |
|---|---|---|---|
| P2 | **Audit archive to S3 via Firehose** (from closed #3) — subscription filter CloudWatch → Firehose → audit-only S3 bucket (separate account ideal) for legal hold. Infra-only. | S | new |
| P2 | **Separate audit log group** (from closed #3) — today app + audit share one group; split so retention policies can diverge (audit → 7y, app → 14d). Pairs with Firehose above. | XS | new |
| P2 | **Object Lock on CloudTrail bucket** (from closed #3) — today the bucket has log-file-validation but no Object Lock. Add governance-mode Object Lock for true legal-hold posture. | XS | new |

## G. Speculative / on-brand

| P | Item | Size | Ticket |
|---|---|---|---|
| P3 | **Schema-browse audit events** (from closed #3) — only if a specific compliance requirement emerges. Currently intentionally omitted (noisy, low value). | XS | when needed |

---

## Conscious "don't build"

| Idea | Why not |
|---|---|
| MCP / LLM integration | Ruled out by client policy. |
| ER diagrams with FK arrows | Glue exposes no FK metadata — would mislead. |
| Cross-database joins | Athena Federated Query covers this server-side. |
| Charting / pivots | In-results group-by (shipped via #8) covers ~80% at a fraction of the cost. |
| Sharing queries between users | Out of scope per CLAUDE.md; named queries cover the personal case. |
| CDN / edge UI concepts | VPC constraint rules them out. |
| Mobile / responsive / i18n / theme toggle | Explicit non-goals per CLAUDE.md. |

---

## Top three to work next

1. **Workspace ↔ query crosslinks** ([#12](https://github.com/chris-arsenault/athena-s3-web-shell/issues/12), already filed) — closes the integration loop.
2. **Silent token refresh** — needs issue. Smallest demo-critical fix; bounded scope.
3. **JSON/Parquet schema inference in CreateTable** — needs issue. Finishes the "drop a file, register it" story for the common case.
