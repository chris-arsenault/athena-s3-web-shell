import type {
  AnalyzeRequest,
  AnalyzeResponse,
  CreateTableRequest,
  CreateTableResponse,
  DatasetColumn,
  DuplicateTableFinding,
  Finding,
  InferSchemaRequest,
  InferSchemaResponse,
  LocationPlan,
  MixedParentFinding,
  NullTokenFinding,
  TableCreatePlan,
  TableDetail,
  TableRef,
  TypeMismatchFinding,
} from "@athena-shell/shared";

import { mockS3 } from "./mockS3Store";
import {
  dropMockTable,
  findMockTableByLocation,
  registerMockTable,
} from "./mockAthena";
import {
  extractJsonRows,
  extractJsonlRows,
  inferCsvSchema,
  inferJsonColumns,
  inferJsonlColumns,
  inferParquetColumns,
  sanitizeIdent,
} from "./mockDatasetsInference";

const WORKSPACE_PREFIX = "users/dev/";
const DATASETS_PREFIX = `${WORKSPACE_PREFIX}datasets/`;
const ARTIFACT_BYTES = 128;

export const mockDatasets = {
  async inferSchema(req: InferSchemaRequest): Promise<InferSchemaResponse> {
    if (req.fileType === "csv" || req.fileType === "tsv") {
      const text = await mockS3.getText(req.key);
      const delimiter = req.fileType === "tsv" ? "\t" : ",";
      return inferCsvSchema(text, delimiter);
    }
    if (req.fileType === "jsonl") {
      const text = await mockS3.getText(req.key);
      const columns = inferJsonlColumns(text, 50);
      const sampleRows = extractJsonlRows(text, columns, 50);
      return { columns, sampleRows, hasHeader: false };
    }
    if (req.fileType === "json") {
      const text = await mockS3.getText(req.key);
      try {
        const columns = inferJsonColumns(text, 50);
        const sampleRows = extractJsonRows(text, columns, 50);
        return { columns, sampleRows, hasHeader: false };
      } catch {
        return { columns: [], sampleRows: [], hasHeader: false };
      }
    }
    if (req.fileType === "parquet") {
      return { columns: await inferParquetColumns(req.key), sampleRows: [], hasHeader: false };
    }
    return { columns: [], sampleRows: [], hasHeader: false };
  },

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const base = await this.inferSchema(req);
    const text =
      req.fileType === "parquet" ? null : await mockS3.getText(req.key);
    const location = planLocation(req);
    const findings: Finding[] = [...location.findings];
    const jsonArrayFinding = detectJsonArrayMock(req.fileType, text);
    if (jsonArrayFinding) findings.push(jsonArrayFinding);
    findings.push(...detectTypeMismatchesMock(base.columns, base.sampleRows));
    findings.push(...detectNullTokensMock(base.columns, base.sampleRows));
    return {
      columns: base.columns,
      sampleRows: base.sampleRows,
      fieldDelimiter: base.fieldDelimiter,
      hasHeader: base.hasHeader,
      location: location.plan,
      findings,
    };
  },

  async createTable(req: CreateTableRequest): Promise<CreateTableResponse> {
    const database = sanitizeIdent(req.database);
    const table = sanitizeIdent(req.table);
    const executionId = `mock-ddl-${rand()}`;
    registerNewMockTable(database, table, req.columns, req.location, executionId);
    return { executionId, database, table };
  },

  async createTableFromPlan(plan: TableCreatePlan): Promise<CreateTableResponse> {
    if (plan.location.strategy === "blocked" || !plan.location.finalLocation) {
      throw new Error("cannot create table from blocked plan");
    }
    const database = sanitizeIdent(plan.database);
    const table = sanitizeIdent(plan.table);
    const rawTable = plan.stringOverrides.length > 0 ? `raw_${table}` : table;
    const executionId = `mock-ddl-${rand()}`;
    const location = plan.location.finalLocation;

    if (plan.replaceExisting) {
      if (plan.stringOverrides.length > 0) dropMockTable(database, table);
      dropMockTable(database, rawTable);
    }

    const rawColumns = applyStringOverrides(plan.columns, plan.stringOverrides);
    registerNewMockTable(database, rawTable, rawColumns, location, executionId);

    if (plan.stringOverrides.length > 0) {
      const viewExec = `mock-ddl-${rand()}`;
      registerNewMockTable(database, table, plan.columns, location, viewExec);
      return {
        executionId: viewExec,
        database,
        table,
        view: table,
      };
    }
    return { executionId, database, table: rawTable };
  },
};

function registerNewMockTable(
  database: string,
  table: string,
  columns: DatasetColumn[],
  location: string,
  executionId: string
): void {
  const ref: TableRef = {
    name: table,
    database,
    type: "EXTERNAL_TABLE",
    location,
  };
  const detail: TableDetail = {
    name: table,
    database,
    type: "EXTERNAL_TABLE",
    columns,
    partitionKeys: [],
    location,
  };
  registerMockTable(ref, detail, executionId);
}

function applyStringOverrides(
  columns: DatasetColumn[],
  overrides: number[]
): DatasetColumn[] {
  if (overrides.length === 0) return columns;
  const set = new Set(overrides);
  return columns.map((c, i) => (set.has(i) ? { ...c, type: "string" } : c));
}

// --- Location planner (mock) ------------------------------------------

interface MockLocationResult {
  plan: LocationPlan;
  findings: Finding[];
}

function planLocation(req: AnalyzeRequest): MockLocationResult {
  const { key, bucket, table } = req;
  const isInsideDatasetsSubdir =
    key.startsWith(DATASETS_PREFIX) && key.slice(DATASETS_PREFIX.length).includes("/");

  if (!isInsideDatasetsSubdir) {
    const tableSlug = sanitizeIdent(table) || "dataset";
    const targetDir = `${DATASETS_PREFIX}${tableSlug}/`;
    const finalLocation = `s3://${bucket}/${targetDir}`;
    const dup = detectDupTable(finalLocation);
    if (dup) return blockPlan(dup, `${dup.existingDatabase}.${dup.existingTable}`);
    return {
      plan: {
        strategy: "move",
        finalLocation,
        summary: `Move source into ${targetDir}`,
      },
      findings: [],
    };
  }

  const parentDir = key.slice(0, key.lastIndexOf("/") + 1);
  const finalLocation = `s3://${bucket}/${parentDir}`;
  const dup = detectDupTable(finalLocation);
  if (dup) return blockPlan(dup, `${dup.existingDatabase}.${dup.existingTable}`);
  const mixed = detectMixedParentMock(parentDir, key);
  if (mixed) {
    return {
      plan: {
        strategy: "blocked",
        summary: "Parent folder has mixed file types — clean it up first.",
      },
      findings: [mixed],
    };
  }
  return {
    plan: {
      strategy: "in-place",
      finalLocation,
      summary: "Register in place — source is already in a clean dataset folder.",
    },
    findings: [],
  };
}

function blockPlan(dup: DuplicateTableFinding, tableRef: string): MockLocationResult {
  return {
    plan: {
      strategy: "blocked",
      summary: `Another table (${tableRef}) already points at this location.`,
    },
    findings: [dup],
  };
}

function detectDupTable(finalLocation: string): DuplicateTableFinding | null {
  const match = findMockTableByLocation(finalLocation);
  if (!match) return null;
  return {
    kind: "duplicate-table",
    severity: "block",
    message: `${match.database}.${match.name} already references ${finalLocation}.`,
    existingDatabase: match.database,
    existingTable: match.name,
    existingLocation: match.location ?? finalLocation,
  };
}

function detectMixedParentMock(parentDir: string, sourceKey: string): MixedParentFinding | null {
  const listing = mockS3.list(parentDir);
  const sourceExt = extensionOf(sourceKey);
  const siblings = listing.objects.filter((o) => o.key !== sourceKey);
  const bad = siblings.filter(
    (s) => extensionOf(s.key) !== sourceExt || s.size < ARTIFACT_BYTES
  );
  if (bad.length === 0) return null;
  return {
    kind: "mixed-parent",
    severity: "block",
    message: `${siblings.length + 1} file(s) in this folder — ${bad.length} don't match.`,
    parentPrefix: parentDir,
    siblingFileNames: bad.slice(0, 20).map((s) => basenameOf(s.key)),
  };
}

// --- Mock findings -----------------------------------------------------

function detectJsonArrayMock(
  fileType: string,
  sampleText: string | null
): Finding | null {
  if (fileType !== "json" || !sampleText) return null;
  if (!sampleText.trimStart().startsWith("[")) return null;
  return {
    kind: "json-array",
    severity: "block",
    message:
      "This looks like a JSON array. Athena's JSON SerDe needs newline-delimited JSON (JSONL). Convert outside the tool, then re-register.",
    suggestedCommands: [
      "jq -c '.[]' input.json > input.jsonl",
      "python -c \"import json; [print(json.dumps(r)) for r in json.load(open('input.json'))]\" > input.jsonl",
    ],
  };
}

const NULL_CANDIDATES = ["N/A", "n/a", "NA", "-", "NULL", "null", "None", "none"];
const OCCURRENCE_THRESHOLD = 0.2;

// Stricter than inference's regex — catches regex-valid but semantically
// broken values (e.g. 2024-00-31, 9999999999999999999). Mirrors
// packages/proxy/src/services/findingsDetector.ts for mock-mode parity.
const STRICT_PARSERS: Record<string, (v: string) => boolean> = {
  bigint: strictIntOk,
  int: strictIntOk,
  date: strictDateOk,
  timestamp: strictTimestampOk,
  double: strictDoubleOk,
};

function strictIntOk(v: string): boolean {
  if (!/^-?\d+$/.test(v)) return false;
  if (v.length > 1 && /^-?0\d/.test(v)) return false;
  return Number.isSafeInteger(Number(v));
}

function strictDoubleOk(v: string): boolean {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return false;
  return Number.isFinite(Number(v));
}

function strictDateOk(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = Date.parse(v);
  if (Number.isNaN(d)) return false;
  const parsed = new Date(d);
  const roundTrip = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  return roundTrip === v;
}

function strictTimestampOk(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

function detectTypeMismatchesMock(
  columns: DatasetColumn[],
  sampleRows: string[][]
): TypeMismatchFinding[] {
  const out: TypeMismatchFinding[] = [];
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]!;
    const parser = STRICT_PARSERS[col.type.toLowerCase().replace(/\(.*/, "")];
    if (!parser) continue;
    const bad: string[] = [];
    for (const row of sampleRows) {
      const cell = row[ci];
      if (cell === undefined || cell === "") continue;
      if (!parser(cell)) bad.push(cell);
    }
    if (bad.length > 0) {
      out.push({
        kind: "type-mismatch",
        severity: "advisory",
        column: col.name,
        inferredType: col.type,
        sampleBadValues: Array.from(new Set(bad)).slice(0, 5),
        message: `${col.name}: ${bad.length} sample row(s) look risky for ${col.type}. Override to STRING so unseen rows in the rest of the file don't produce BAD_DATA.`,
      });
    }
  }
  return out;
}

function detectNullTokensMock(
  columns: DatasetColumn[],
  sampleRows: string[][]
): NullTokenFinding[] {
  if (sampleRows.length === 0) return [];
  const out: NullTokenFinding[] = [];
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]!;
    const counts = new Map<string, number>();
    for (const row of sampleRows) {
      const cell = row[ci];
      if (cell === undefined) continue;
      if (NULL_CANDIDATES.includes(cell)) {
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    }
    for (const [token, n] of counts) {
      const ratio = n / sampleRows.length;
      if (ratio < OCCURRENCE_THRESHOLD) continue;
      out.push({
        kind: "null-token",
        severity: "advisory",
        column: col.name,
        token,
        occurrenceRatio: ratio,
        message: `${col.name}: '${token}' appears in ${Math.round(ratio * 100)}% of rows. Treat as NULL via SerDe null.format.`,
      });
      break;
    }
  }
  return out;
}

function extensionOf(key: string): string {
  const base = basenameOf(key).toLowerCase();
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1);
}

function basenameOf(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? key : key.slice(i + 1);
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
