# Audit event schema

Every audit event is a single-line JSON object written to the proxy's stdout, captured by ECS's `awslogs` driver into the `/ecs/athena-shell-proxy` CloudWatch Logs group. Filter by `{ $.kind = "audit" }` to get just the audit stream.

S3-side audit (uploads / downloads / list / delete) is captured separately by **CloudTrail data events** on the data + results buckets — those events land in the `athena-shell-cloudtrail-<acct>` S3 bucket under `AWSLogs/<acct>/CloudTrail/…`. The proxy never sees browser-direct S3 traffic, so the proxy audit log by design says nothing about S3 operations.

---

## Common envelope (every proxy audit event)

```jsonc
{
  "kind": "audit",
  "event": "query.start",   // see table below
  "level": "info",
  "ts": "2026-04-16T19:23:41.117Z",
  "service": "athena-shell-proxy",
  "requestId": "abc-123-def",           // joins with morgan HTTP log
  "sourceIp": "10.42.0.5",              // resolved via X-Forwarded-For (trust proxy on)
  "user": {
    "id": "cognito-sub-uuid",
    "name": "test_athena_1",
    "email": "test_athena_1@shell.ahara.io"
  },
  "outcome": "ok"                       // "ok" | "error"
}
```

`user` is `null` for unauthenticated routes (only `/api/health` today). `outcome = "error"` is followed by an `errorMessage` field.

## Per-event attributes

### Query lifecycle

| `event` | Fires on | Additional fields |
|---|---|---|
| `query.start` | `POST /api/query` success | `sqlFingerprint` (redacted + normalized), `sqlHash` (16-char sha256 of the fingerprint), `database`, `workgroup`, `executionId` |
| `query.end` | First terminal-state `GET /api/query/:id` response; deduped per `executionId` | `executionId`, `state` (`SUCCEEDED`/`FAILED`/`CANCELLED`), `dataScannedBytes`, `totalExecutionMs`, `completedAt`, `errorMessage` (on non-success) |
| `query.stop` | `DELETE /api/query/:id` | `executionId` |
| `query.results` | `GET /api/query/:id/results` success | `executionId`, `rowCount`, `hasMore` |
| `query.download` | `GET /api/query/:id/download` | `executionId`, `outputLocation` (s3:// URL) |

### Dataset operations

| `event` | Fires on | Additional fields |
|---|---|---|
| `datasets.infer` | `POST /api/datasets/infer` success | `bucket`, `key`, `fileType` |
| `datasets.create_table` | `POST /api/datasets/create-table` success | `database`, `table`, `location`, `fileType`, `executionId` |

## SQL redaction

The proxy **never logs raw SQL**. `query.start` includes:

- `sqlFingerprint` — normalized form with string literals collapsed to `'?'`, numeric literals to `?`, and comments stripped. Safe to show to reviewers; usually enough to understand what shape of query was run.
- `sqlHash` — first 16 hex chars of SHA-256 over the normalized form. Stable across sessions and users, so you can answer "how many times was this query shape run?" or "did user A and user B run the same query" without exposing either party's literal values.

If a reviewer specifically needs the original SQL (e.g., for a root-cause investigation), it's still recoverable from Athena's own query history via `aws athena get-query-execution --query-execution-id <id>` — that's already authoritative within Athena's 45-day retention, and falls under Athena's access logs rather than ours.

---

## Query examples (CloudWatch Logs Insights)

Target log group: `/ecs/athena-shell-proxy` in `us-east-1`.

### All audit events from the last hour

```
fields @timestamp, event, user.name, sourceIp, outcome
| filter kind = "audit"
| sort @timestamp desc
| limit 200
```

### Queries by a specific user

```
fields @timestamp, event, executionId, sqlHash, sqlFingerprint
| filter kind = "audit" and user.name = "test_athena_1" and event like /^query\./
| sort @timestamp desc
| limit 100
```

### Most frequently-run query shapes

```
fields sqlHash, sqlFingerprint
| filter kind = "audit" and event = "query.start"
| stats count() as runs by sqlHash, sqlFingerprint
| sort runs desc
| limit 20
```

### Queries that scanned > 100 MB

```
fields @timestamp, user.name, dataScannedBytes, executionId
| filter kind = "audit" and event = "query.end" and dataScannedBytes > 104857600
| sort dataScannedBytes desc
```

### Failed queries + their error messages

```
fields @timestamp, user.name, executionId, state, errorMessage
| filter kind = "audit" and event = "query.end" and outcome = "error"
| sort @timestamp desc
```

### Join HTTP log ↔ audit event via requestId

```
fields @timestamp, @message
| filter @message like "abc-123-def"
| sort @timestamp
```

(Any `requestId` value in an audit event also appears at the start of the HTTP access-log line, so a single search pulls both.)

---

## Query examples (Athena over CloudTrail logs for S3 audit)

CloudTrail data events land as JSON.gz under `s3://athena-shell-cloudtrail-<acct>/AWSLogs/<acct>/CloudTrail/<region>/YYYY/MM/DD/`. Typical pattern: create an Athena table over that prefix (CloudTrail publishes a schema) and filter on `eventName`.

### All S3 object operations by a specific user role

```sql
SELECT eventTime, eventName, userIdentity.arn AS role, requestParameters
FROM cloudtrail_logs
WHERE eventName IN ('GetObject', 'PutObject', 'DeleteObject', 'ListBucket')
  AND userIdentity.arn LIKE '%athena-shell-user-test_athena_1%'
ORDER BY eventTime DESC
LIMIT 100;
```

### Uploads by bucket + prefix

```sql
SELECT eventTime, userIdentity.arn, requestParameters
FROM cloudtrail_logs
WHERE eventName = 'PutObject'
  AND requestParameters LIKE '%"bucketName":"athena-shell-data-%'
ORDER BY eventTime DESC;
```

---

## Tamper-evidence posture

- **Proxy audit events** land in CloudWatch Logs via the ECS `awslogs` driver. The ECS task role has `logs:PutLogEvents` only (no delete, no retention-policy mutation) — see `iam-proxy.tf`'s execution role. CloudWatch Logs are append-only from the task's perspective; altering past records requires higher-privileged credentials.
- **CloudTrail data events** land in an S3 bucket with versioning enabled, public-access blocked, and log file validation turned on. Once written, any mutation creates a new version (detectable) and CloudTrail's own integrity manifest is invalidated (detectable via `aws cloudtrail validate-logs`).
- Neither the proxy task role nor the per-user IAM roles can modify either destination.

---

## What this doesn't do

- No Object Lock retention on the CloudTrail bucket — add for true legal hold. Tracked as a follow-up.
- No PII redaction beyond SQL literals. If an audit reviewer flags, say, filename PII in `datasets.create_table` events, add per-field hashing.
- No audit subscription filter into a separate log group. Single-group design with `$.kind = "audit"` filter — simpler operationally. Revisit if retention policy on audit needs to diverge from the general app log.
