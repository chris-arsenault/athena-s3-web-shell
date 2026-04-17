import type {
  DatasetColumn,
  DatasetFileType,
  Finding,
  JsonArrayFinding,
  NullTokenFinding,
  SerdeMismatchFinding,
  TypeMismatchFinding,
} from "@athena-shell/shared";

/**
 * Pure, sync detectors that run on the output of `inferSchema`. The
 * analyze orchestrator wires them up; tests can drive each in isolation.
 *
 * None of these are hard blocks (see locationAnalyzer for those). The
 * SPA renders them as amber advisories; user accepts → they flip DDL
 * knobs, user dismisses → nothing changes.
 */

// --- Type mismatch -----------------------------------------------------

/**
 * Stricter than the inference regexes: catches values that SEMANTICALLY
 * fail the declared type even though they MATCH the inference regex. The
 * demo case is a BIGINT column carrying a value past Number.MAX_SAFE_INTEGER
 * (regex passes, SQL `CAST(... AS BIGINT)` fails) or a DATE column carrying
 * "2024-00-31" (regex passes, `Date.parse` returns NaN, Athena throws
 * BAD_DATA at query time).
 *
 * When the inference picked a narrow type and at least one sample row fails
 * the strict parse, we emit an advisory so the modal can auto-resolve the
 * column to STRING (defense in depth for unseen rows in the rest of the file).
 */
const STRICT_PARSERS: Record<string, (v: string) => boolean> = {
  bigint: strictIntOk,
  int: strictIntOk,
  smallint: strictIntOk,
  tinyint: strictIntOk,
  double: strictDoubleOk,
  float: strictDoubleOk,
  decimal: strictDoubleOk,
  date: strictDateOk,
  timestamp: strictTimestampOk,
  boolean: (v) => v === "true" || v === "false",
};

function strictIntOk(v: string): boolean {
  if (!/^-?\d+$/.test(v)) return false;
  // Leading zeros usually mean identifier-as-number, not a real count.
  if (v.length > 1 && (v === "0" ? false : /^-?0\d/.test(v))) return false;
  const n = Number(v);
  return Number.isSafeInteger(n);
}

function strictDoubleOk(v: string): boolean {
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return false;
  return Number.isFinite(Number(v));
}

function strictDateOk(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = Date.parse(v);
  if (Number.isNaN(d)) return false;
  // Round-trip the parsed date back to YYYY-MM-DD and compare. Catches
  // things like 2024-00-31 which Date.parse is permissive with.
  const parsed = new Date(d);
  const roundTrip = `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  return roundTrip === v;
}

function strictTimestampOk(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

export function detectTypeMismatches(
  columns: DatasetColumn[],
  sampleRows: string[][]
): TypeMismatchFinding[] {
  const out: TypeMismatchFinding[] = [];
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]!;
    const parser = STRICT_PARSERS[col.type.toLowerCase().replace(/\(.*/, "")];
    if (!parser) continue; // no check for string / struct / etc.
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
        sampleBadValues: unique(bad).slice(0, 5),
        message: `${col.name}: ${bad.length} sample row(s) look risky for ${col.type}. Override to STRING so unseen rows in the rest of the file don't produce BAD_DATA.`,
      });
    }
  }
  return out;
}

// --- Null tokens -------------------------------------------------------

const NULL_CANDIDATES = ["N/A", "n/a", "NA", "-", "NULL", "null", "None", "none", ""];
const OCCURRENCE_THRESHOLD = 0.2;

export function detectNullTokens(
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
      if (token === "") continue; // empty string is normal absence, not a null token
      out.push({
        kind: "null-token",
        severity: "advisory",
        column: col.name,
        token,
        occurrenceRatio: ratio,
        message: `${col.name}: '${token}' appears in ${Math.round(ratio * 100)}% of rows. Treat as NULL via SerDe null.format.`,
      });
      break; // one finding per column
    }
  }
  return out;
}

// --- JSON array --------------------------------------------------------

export function detectJsonArray(
  fileType: DatasetFileType,
  sampleText: string | null
): JsonArrayFinding | null {
  if (fileType !== "json") return null;
  if (!sampleText) return null;
  const trimmed = sampleText.trimStart();
  if (!trimmed.startsWith("[")) return null;
  return {
    kind: "json-array",
    severity: "block",
    message:
      "This looks like a JSON array. Athena's JSON SerDe needs newline-delimited JSON (JSONL). Convert outside the tool, then re-register.",
    suggestedCommands: [
      "jq -c '.[]' input.json > input.jsonl",
      "python -c \"import json,sys; [print(json.dumps(r)) for r in json.load(open('input.json'))]\" > input.jsonl",
    ],
  };
}

// --- SerDe mismatch (CSV with quoted-embedded-delimiters) --------------

/**
 * Flag when a CSV sample has rows containing a quoted field with an
 * embedded delimiter — LazySimpleSerDe (our forgiving default when
 * null.format is set) will split on the delimiter anyway, corrupting
 * the row. Suggest swapping to OpenCSVSerde which honours quoting.
 */
export function detectSerdeMismatch(
  fileType: DatasetFileType,
  sampleText: string | null,
  fieldDelimiter?: string
): SerdeMismatchFinding | null {
  if (fileType !== "csv" && fileType !== "tsv") return null;
  if (!sampleText) return null;
  const delim = fieldDelimiter ?? (fileType === "tsv" ? "\t" : ",");
  // Look for `"..delim..."` anywhere in the sample.
  const re = new RegExp(`"[^"\\n]*${escapeRegex(delim)}[^"\\n]*"`);
  if (!re.test(sampleText)) return null;
  return {
    kind: "serde-mismatch",
    severity: "advisory",
    currentSerde: "LazySimpleSerDe",
    message:
      "This CSV has quoted fields containing the delimiter. LazySimpleSerDe will split them incorrectly — use OpenCSVSerde.",
  };
}

// --- helpers -----------------------------------------------------------

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type { Finding };
