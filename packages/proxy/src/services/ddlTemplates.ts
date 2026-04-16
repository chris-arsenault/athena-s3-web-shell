import type { CreateTableRequest } from "@athena-shell/shared";

/**
 * Athena DDL templates, one per supported file type.
 *
 * Kept as pure string builders rather than a dispatch so each template is
 * grep-able end-to-end. Security caveat: `database`, `table`, and column
 * names are interpolated — they MUST have been sanitised at the route
 * layer (see sanitizeIdent). Never let user input reach here unsanitised.
 */

export function csvTableDdl(req: CreateTableRequest): string {
  const cols = renderColumns(req.columns);
  const normLoc = normalizeLocation(req.location);
  const skip = req.skipHeader ? 1 : 0;
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${req.database}\`.\`${req.table}\` (
  ${cols}
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
WITH SERDEPROPERTIES ("separatorChar"=",", "quoteChar"="\\"", "escapeChar"="\\\\")
LOCATION '${normLoc}'
TBLPROPERTIES ("skip.header.line.count"="${skip}", "has_encrypted_data"="false")`;
}

export function tsvTableDdl(req: CreateTableRequest): string {
  const cols = renderColumns(req.columns);
  const normLoc = normalizeLocation(req.location);
  const skip = req.skipHeader ? 1 : 0;
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${req.database}\`.\`${req.table}\` (
  ${cols}
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
WITH SERDEPROPERTIES ("separatorChar"="\\t", "quoteChar"="\\"", "escapeChar"="\\\\")
LOCATION '${normLoc}'
TBLPROPERTIES ("skip.header.line.count"="${skip}")`;
}

export function parquetTableDdl(req: CreateTableRequest): string {
  const cols = renderColumns(req.columns);
  const normLoc = normalizeLocation(req.location);
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${req.database}\`.\`${req.table}\` (
  ${cols}
)
STORED AS PARQUET
LOCATION '${normLoc}'`;
}

export function jsonTableDdl(req: CreateTableRequest): string {
  const cols = renderColumns(req.columns);
  const normLoc = normalizeLocation(req.location);
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${req.database}\`.\`${req.table}\` (
  ${cols}
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
LOCATION '${normLoc}'`;
}

export function ddlForRequest(req: CreateTableRequest): string {
  switch (req.fileType) {
    case "csv":
      return csvTableDdl(req);
    case "tsv":
      return tsvTableDdl(req);
    case "parquet":
      return parquetTableDdl(req);
    case "json":
    case "jsonl":
      return jsonTableDdl(req);
  }
}

export function createDatabaseDdl(database: string): string {
  return `CREATE DATABASE IF NOT EXISTS \`${database}\``;
}

// Ensure identifiers are safe for Athena/Hive:
//   - alphanumeric + underscore, must not start with a digit
//   - lowercased (Hive folds case anyway)
export function sanitizeIdent(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!cleaned) return "c";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function renderColumns(cols: { name: string; type: string }[]): string {
  return cols
    .map((c) => `\`${sanitizeIdent(c.name)}\` ${sanitizeColumnType(c.type)}`)
    .join(",\n  ");
}

// Conservative allowlist of Hive/Athena types.
const ALLOWED_TYPES = new Set([
  "string",
  "bigint",
  "int",
  "integer",
  "smallint",
  "tinyint",
  "double",
  "float",
  "decimal",
  "boolean",
  "date",
  "timestamp",
]);

function sanitizeColumnType(raw: string): string {
  const t = raw.trim().toLowerCase();
  // decimal(10,2) etc. — accept if the base type is allowed
  const base = t.replace(/\([^)]*\)$/, "").trim();
  if (ALLOWED_TYPES.has(base)) return t;
  return "string";
}

function normalizeLocation(raw: string): string {
  // Athena wants a folder URL ending in /
  return raw.endsWith("/") ? raw : `${raw}/`;
}
