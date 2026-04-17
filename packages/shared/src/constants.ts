export const API_BASE = "/api";

export const QUERY_POLL_INTERVAL_MS = 1000;
export const QUERY_POLL_BACKOFF_MAX_MS = 5000;
export const QUERY_POLL_TIMEOUT_MS = 10 * 60 * 1000;

export const SCHEMA_PAGE_SIZE = 100;
export const HISTORY_PAGE_SIZE = 50;
export const RESULTS_PAGE_SIZE = 1000;
// Hard ceiling on rows the SPA keeps in memory. When reached, the "load more"
// affordance is replaced with a "download CSV for full set" banner. Raised
// from 10k when "load more" beyond page 1 switched to direct-from-S3 CSV
// fetch — at that point the pagination cost collapses and keeping more rows
// client-side is feasible.
export const RESULTS_ROW_CAP = 100_000;

export const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024;
export const MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MULTIPART_QUEUE_SIZE = 4;

export const MOCK_USER_HEADER = "x-mock-user";

// Proxy-passthrough AWS credential headers — the SPA reads its STS creds
// from the Identity Pool and attaches them per request so the proxy can
// issue Athena/Glue calls under the caller's own role.
export const AWS_ACCESS_KEY_HEADER = "x-aws-access-key-id";
export const AWS_SECRET_KEY_HEADER = "x-aws-secret-access-key";
export const AWS_SESSION_TOKEN_HEADER = "x-aws-session-token";
