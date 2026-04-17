export type DatasetFileType = "csv" | "tsv" | "json" | "jsonl" | "parquet";

export interface DatasetColumn {
  name: string;
  type: string;
}

export interface InferSchemaRequest {
  bucket: string;
  key: string;
  fileType: DatasetFileType;
  sampleBytes?: number;
}

export interface InferSchemaResponse {
  columns: DatasetColumn[];
  fieldDelimiter?: string;
  hasHeader: boolean;
  /** First-N parsed rows, values stringified, in the same column order
   *  as `columns`. Empty array for Parquet (metadata-only inference). */
  sampleRows: string[][];
}

export interface CreateTableRequest {
  database: string;
  table: string;
  /** s3://bucket/prefix/ — must be a folder, not an object key. */
  location: string;
  fileType: DatasetFileType;
  columns: DatasetColumn[];
  skipHeader?: boolean;
}

export interface CreateTableResponse {
  executionId: string;
  database: string;
  table: string;
  /** Present when a companion VIEW was emitted (at least one column was
   *  overridden to STRING). The view wraps the raw table with TRY_CAST so
   *  end-user queries see typed columns. Raw table name is `raw_<view>`. */
  view?: string;
}

// ---------------------------------------------------------------------------
// Analyze step — review-stage data surfaced before CREATE TABLE commits.

export interface AnalyzeRequest {
  bucket: string;
  key: string;
  fileType: DatasetFileType;
  /** Proposed table name; used for location planning (e.g. move target
   *  dir) and duplicate-table detection. */
  table: string;
  /** Optional size hint; SPA may pass the S3 ListObjects size so we can
   *  decide whether a move is feasible. */
  sizeBytes?: number;
}

export type LocationStrategy = "move" | "in-place" | "blocked";

export interface LocationPlan {
  strategy: LocationStrategy;
  /** S3 URL (s3://bucket/prefix/) that Athena will read from. Absent when
   *  strategy === "blocked". */
  finalLocation?: string;
  /** Human-readable summary the modal renders as the location section. */
  summary: string;
}

/**
 * Advisory (kind: "type-mismatch" | "null-token" | "serde-mismatch" |
 * "json-array") OR structural (kind: "duplicate-table" | "mixed-parent").
 * Structural findings are always hard-blocks; advisories can be resolved
 * or dismissed.
 */
export type Finding =
  | TypeMismatchFinding
  | NullTokenFinding
  | SerdeMismatchFinding
  | JsonArrayFinding
  | DuplicateTableFinding
  | MixedParentFinding;

interface FindingBase {
  kind: string;
  severity: "advisory" | "block";
  message: string;
}

export interface TypeMismatchFinding extends FindingBase {
  kind: "type-mismatch";
  severity: "advisory";
  column: string;
  inferredType: string;
  sampleBadValues: string[];
}

export interface NullTokenFinding extends FindingBase {
  kind: "null-token";
  severity: "advisory";
  column: string;
  token: string;
  occurrenceRatio: number;
}

export interface SerdeMismatchFinding extends FindingBase {
  kind: "serde-mismatch";
  severity: "advisory";
  /** The SerDe we'd use by default; resolution flips to the other. */
  currentSerde: "LazySimpleSerDe" | "OpenCSVSerde";
}

export interface JsonArrayFinding extends FindingBase {
  kind: "json-array";
  severity: "block";
  /** Suggested external conversion command(s). */
  suggestedCommands: string[];
}

export interface DuplicateTableFinding extends FindingBase {
  kind: "duplicate-table";
  severity: "block";
  existingDatabase: string;
  existingTable: string;
  /** Location of the existing table. */
  existingLocation: string;
}

export interface MixedParentFinding extends FindingBase {
  kind: "mixed-parent";
  severity: "block";
  parentPrefix: string;
  siblingFileNames: string[];
}

export interface AnalyzeResponse {
  columns: DatasetColumn[];
  /** First-N sample rows used for finding detection — surfaced so the SPA
   *  can render "as Athena would see" previews if desired. */
  sampleRows: string[][];
  fieldDelimiter?: string;
  hasHeader: boolean;
  location: LocationPlan;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Resolved plan — submitted on Create.

export interface ColumnOverride {
  /** Zero-based index into the original `columns` array from analyze. */
  columnIndex: number;
  /** Override type (v1 only supports "string"). */
  type: "string";
}

export type CsvSerde = "LazySimpleSerDe" | "OpenCSVSerde";

/**
 * Everything the proxy needs to execute CREATE TABLE. The SPA fills this
 * in from the analyze response plus the user's resolve choices.
 */
export interface TableCreatePlan {
  database: string;
  /** Clean name the user types. If the plan carries STRING overrides, the
   *  raw table becomes `raw_<table>` and a view named `<table>` wraps it
   *  with TRY_CAST. Otherwise the table takes this name directly. */
  table: string;
  fileType: DatasetFileType;
  columns: DatasetColumn[];
  /** Indexes of columns the user overrode to STRING. Drives VIEW emission. */
  stringOverrides: number[];
  /** Computed by analyze; the SPA just forwards it. */
  location: LocationPlan;
  /** CSV-only; absent for other fileTypes. */
  csvSerde?: CsvSerde;
  /** null.format to set on the SerDe (null-token resolve). */
  nullFormat?: string;
  /** timestamp.formats to set on LazySimpleSerDe (future; null-safe now). */
  timestampFormats?: string;
  /** True when replacing a duplicate-table finding. Issues DROP+CREATE. */
  replaceExisting?: boolean;
  skipHeader?: boolean;
}
