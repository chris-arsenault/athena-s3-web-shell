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
}
