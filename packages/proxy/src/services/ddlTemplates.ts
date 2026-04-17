import type {
  CreateTableRequest,
  CsvSerde,
  DatasetColumn,
  DatasetFileType,
  TableCreatePlan,
} from "@athena-shell/shared";

/**
 * Athena DDL templates.
 *
 * Security caveat: database, table, and column names are interpolated.
 * They MUST have been sanitised at the route layer (see sanitizeIdent).
 * Never let user input reach here unsanitised.
 */

// --- Low-level per-fileType builders -----------------------------------

export interface CsvTableOptions {
  columns: DatasetColumn[];
  database: string;
  table: string;
  location: string;
  skipHeader?: boolean;
  serde?: CsvSerde;
  nullFormat?: string;
  timestampFormats?: string;
  delimiter?: string;
}

// Default set of timestamp formats we emit for LazySimpleSerDe. Covers
// ISO-8601 (with T separator), SQL-style (space separator), and bare
// yyyy-MM-dd (promoted into the timestamp column). Users with exotic
// formats can later plug a custom `timestampFormats` via the plan.
const DEFAULT_TIMESTAMP_FORMATS =
  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX,yyyy-MM-dd'T'HH:mm:ssXXX,yyyy-MM-dd'T'HH:mm:ss,yyyy-MM-dd HH:mm:ss.SSS,yyyy-MM-dd HH:mm:ss,yyyy-MM-dd";

export function csvTableDdl(opts: CsvTableOptions): string {
  // Default to LazySimpleSerDe. OpenCSVSerde only stores STRING natively
  // (DATE/TIMESTAMP require UNIX numeric form) and is a footgun unless
  // the CSV has quoted fields containing the delimiter — at which point
  // the SerDe-mismatch finding surfaces and the user opts in explicitly.
  const serde = opts.serde ?? "LazySimpleSerDe";
  return serde === "OpenCSVSerde" ? openCsvSerdeDdl(opts) : lazySimpleSerdeDdl(opts);
}

function openCsvSerdeDdl(opts: CsvTableOptions): string {
  const cols = renderColumns(opts.columns);
  const normLoc = normalizeLocation(opts.location);
  const skip = opts.skipHeader ? 1 : 0;
  const delim = opts.delimiter ?? ",";
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${opts.database}\`.\`${opts.table}\` (
  ${cols}
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
WITH SERDEPROPERTIES ("separatorChar"="${escapeDelim(delim)}", "quoteChar"="\\"", "escapeChar"="\\\\")
LOCATION '${normLoc}'
TBLPROPERTIES ("skip.header.line.count"="${skip}", "has_encrypted_data"="false")`;
}

function lazySimpleSerdeDdl(opts: CsvTableOptions): string {
  const cols = renderColumns(opts.columns);
  const normLoc = normalizeLocation(opts.location);
  const skip = opts.skipHeader ? 1 : 0;
  const delim = opts.delimiter ?? ",";
  const serdeProps: string[] = [];
  if (opts.nullFormat !== undefined) {
    serdeProps.push(`"serialization.null.format"="${escapeValue(opts.nullFormat)}"`);
  }
  const tsFormats = opts.timestampFormats ?? (hasTimestampColumn(opts.columns) ? DEFAULT_TIMESTAMP_FORMATS : undefined);
  if (tsFormats) {
    serdeProps.push(`"timestamp.formats"="${escapeValue(tsFormats)}"`);
  }
  const serdePropsClause =
    serdeProps.length > 0 ? `\nWITH SERDEPROPERTIES (${serdeProps.join(", ")})` : "";
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${opts.database}\`.\`${opts.table}\` (
  ${cols}
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY '${escapeDelim(delim)}'${serdePropsClause}
LOCATION '${normLoc}'
TBLPROPERTIES ("skip.header.line.count"="${skip}")`;
}

function hasTimestampColumn(cols: DatasetColumn[]): boolean {
  return cols.some((c) => /^(timestamp)(\s|\(|$)/i.test(c.type.trim()));
}

export function parquetTableDdl(
  database: string,
  table: string,
  columns: DatasetColumn[],
  location: string
): string {
  const cols = renderColumns(columns);
  const normLoc = normalizeLocation(location);
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${database}\`.\`${table}\` (
  ${cols}
)
STORED AS PARQUET
LOCATION '${normLoc}'`;
}

export function jsonTableDdl(
  database: string,
  table: string,
  columns: DatasetColumn[],
  location: string
): string {
  const cols = renderColumns(columns);
  const normLoc = normalizeLocation(location);
  return `CREATE EXTERNAL TABLE IF NOT EXISTS \`${database}\`.\`${table}\` (
  ${cols}
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES ("ignore.malformed.json"="true", "dots.in.keys"="false", "case.insensitive"="true")
LOCATION '${normLoc}'
TBLPROPERTIES ("classification"="json")`;
}

// --- Back-compat: the old CreateTableRequest path (used by tests) ------

export function ddlForRequest(req: CreateTableRequest): string {
  const { database, table, location, columns, fileType, skipHeader } = req;
  if (fileType === "csv" || fileType === "tsv") {
    return csvTableDdl({
      columns,
      database,
      table,
      location,
      skipHeader,
      delimiter: fileType === "tsv" ? "\t" : ",",
    });
  }
  if (fileType === "parquet") return parquetTableDdl(database, table, columns, location);
  if (fileType === "json" || fileType === "jsonl") {
    return jsonTableDdl(database, table, columns, location);
  }
  throw new Error(`unknown fileType: ${fileType as string}`);
}

// --- Plan-based DDL generator -----------------------------------------

export interface PlanDdl {
  /** Underlying table name (raw_<name> when a view is emitted, else the
   *  user's chosen name). This is what Athena registers in Glue. */
  rawTable: string;
  /** Present when any column was overridden to STRING — the companion
   *  view wraps TRY_CAST'd columns behind the user's chosen name. */
  viewName?: string;
  /** Ordered list of SQL statements to execute through Athena. */
  statements: string[];
}

export function ddlForPlan(plan: TableCreatePlan): PlanDdl {
  const hasOverrides = plan.stringOverrides.length > 0;
  const rawTable = hasOverrides ? `raw_${plan.table}` : plan.table;
  const viewName = hasOverrides ? plan.table : undefined;
  const effectiveColumns = applyStringOverrides(plan.columns, plan.stringOverrides);

  const statements: string[] = [];
  if (plan.replaceExisting) {
    // DROP VIEW + DROP TABLE go through Athena's Trino engine, which
    // rejects backtick-quoted identifiers ("backquoted identifiers are
    // not supported; use double quotes"). sanitizeIdent already narrows
    // to [a-z0-9_], so unquoted is safe.
    if (hasOverrides) {
      statements.push(`DROP VIEW IF EXISTS ${plan.database}.${plan.table}`);
    }
    statements.push(`DROP TABLE IF EXISTS ${plan.database}.${rawTable}`);
  }
  const loc = plan.location.finalLocation;
  if (!loc) throw new Error("ddlForPlan called with no finalLocation");
  statements.push(buildTableStatement(plan, effectiveColumns, rawTable, loc));
  if (viewName) {
    statements.push(buildViewStatement(plan, rawTable, viewName));
  }
  return { rawTable, viewName, statements };
}

function buildTableStatement(
  plan: TableCreatePlan,
  columns: DatasetColumn[],
  rawTable: string,
  location: string
): string {
  const { database, fileType, skipHeader, csvSerde, nullFormat, timestampFormats } = plan;
  if (fileType === "csv" || fileType === "tsv") {
    return csvTableDdl({
      columns,
      database,
      table: rawTable,
      location,
      skipHeader,
      serde: csvSerde ?? "LazySimpleSerDe",
      nullFormat,
      timestampFormats,
      delimiter: fileType === "tsv" ? "\t" : ",",
    });
  }
  if (fileType === "parquet") {
    return parquetTableDdl(database, rawTable, columns, location);
  }
  if (fileType === "json" || fileType === "jsonl") {
    return jsonTableDdl(database, rawTable, columns, location);
  }
  throw new Error(`unknown fileType: ${fileType as DatasetFileType}`);
}

function buildViewStatement(
  plan: TableCreatePlan,
  rawTable: string,
  viewName: string
): string {
  // CREATE VIEW is parsed by Trino (Athena engine v3). Trino rejects
  // backtick-quoted identifiers ("backquoted identifiers are not
  // supported; use double quotes"). Our sanitizer already constrains
  // identifiers to [a-z0-9_], so unquoted is safe here.
  const overrides = new Set(plan.stringOverrides);
  const selectList = plan.columns
    .map((c, idx) => {
      const colName = sanitizeIdent(c.name);
      if (overrides.has(idx)) {
        const target = sanitizeColumnType(c.type);
        return `  TRY_CAST(${colName} AS ${target}) AS ${colName}`;
      }
      return `  ${colName}`;
    })
    .join(",\n");
  return `CREATE OR REPLACE VIEW ${plan.database}.${viewName} AS
SELECT
${selectList}
FROM ${plan.database}.${rawTable}`;
}

function applyStringOverrides(
  columns: DatasetColumn[],
  overrides: number[]
): DatasetColumn[] {
  if (overrides.length === 0) return columns;
  const set = new Set(overrides);
  return columns.map((c, i) => (set.has(i) ? { ...c, type: "string" } : c));
}

// --- Shared helpers ---------------------------------------------------

export function createDatabaseDdl(database: string): string {
  return `CREATE DATABASE IF NOT EXISTS \`${database}\``;
}

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
  const base = t.replace(/\([^)]*\)$/, "").trim();
  if (ALLOWED_TYPES.has(base)) return t;
  return "string";
}

function normalizeLocation(raw: string): string {
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function escapeDelim(delim: string): string {
  if (delim === "\t") return "\\t";
  return delim;
}

function escapeValue(v: string): string {
  return v.replace(/"/g, '\\"');
}
