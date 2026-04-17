import type { AuthContext } from "@athena-shell/shared";

import type { AuthProvider } from "../../auth/AuthProvider";
import { getObjectBytes, getObjectSize } from "../../data/s3Repo";

/**
 * Reads just the footer metadata of a Parquet file via ranged GET.
 * Delegates to hyparquet — pure JS, no wasm — and dynamic-imports it
 * so the bundle cost only lands when the user opens a `.parquet`.
 */

export interface ParquetMeta {
  numRows: number;
  numRowGroups: number;
  columns: { name: string; type: string }[];
  createdBy?: string;
}

export async function loadParquetMeta(
  provider: AuthProvider,
  ctx: AuthContext,
  key: string
): Promise<ParquetMeta> {
  const { parquetMetadataAsync } = await import("hyparquet");
  const byteLength = await getObjectSize(provider, ctx, key);
  const asyncBuffer = {
    byteLength,
    async slice(start: number, end: number = byteLength) {
      return getObjectBytes(provider, ctx, key, start, end);
    },
  };
  const md = await parquetMetadataAsync(asyncBuffer);
  return normalize(md);
}

interface HyparquetMeta {
  num_rows: bigint;
  row_groups: unknown[];
  schema: { name: string; type?: string }[];
  created_by?: string;
}

function normalize(md: HyparquetMeta): ParquetMeta {
  // hyparquet's schema[0] is the root ("schema"); real columns are the rest.
  const columns = md.schema
    .slice(1)
    .map((s) => ({ name: s.name, type: s.type ?? "group" }));
  return {
    numRows: Number(md.num_rows),
    numRowGroups: md.row_groups.length,
    columns,
    createdBy: md.created_by,
  };
}
