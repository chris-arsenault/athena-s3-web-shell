import type { TableRef } from "@athena-shell/shared";

import { locationToPrefix } from "./locationToPrefix";

/**
 * Given the current set of known tables and an S3 key (file or folder),
 * return the table whose `LOCATION` covers the key.
 *
 * Matches when `key` starts with the table's location prefix. Falls
 * through to `null` when no table claims the key — callers use that
 * to suppress the "query this table" affordance.
 *
 * When multiple tables could match (nested `LOCATION` paths, e.g.
 * a user deliberately registered both `s3://b/dir/` and
 * `s3://b/dir/sub/`), returns the one with the longest matching
 * prefix — the most specific table wins.
 */
export interface BackingTable {
  database: string;
  table: string;
  location: string;
}

export function findBackingTable(
  key: string,
  bucket: string,
  tables: readonly TableRef[]
): BackingTable | null {
  let best: { ref: TableRef; prefixLen: number } | null = null;
  for (const t of tables) {
    if (!t.location) continue;
    const parsed = locationToPrefix(t.location);
    if (!parsed) continue;
    if (parsed.bucket !== bucket) continue;
    if (!keyCoveredBy(key, parsed.prefix)) continue;
    if (!best || parsed.prefix.length > best.prefixLen) {
      best = { ref: t, prefixLen: parsed.prefix.length };
    }
  }
  if (!best) return null;
  return {
    database: best.ref.database,
    table: best.ref.name,
    location: best.ref.location!,
  };
}

function keyCoveredBy(key: string, prefix: string): boolean {
  if (prefix === "") return true;
  // A key covers its own prefix: `dir/` is covered by `dir/`.
  // A file under a prefix: `dir/file.csv` is covered by `dir/`.
  if (key === prefix) return true;
  if (key === prefix.slice(0, -1)) return true; // `dir` covered by `dir/`
  return key.startsWith(prefix);
}
