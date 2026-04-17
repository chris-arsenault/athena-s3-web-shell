import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import type { GlueClient } from "@aws-sdk/client-glue";

import type {
  AuthContext,
  DuplicateTableFinding,
  Finding,
  LocationPlan,
  MixedParentFinding,
} from "@athena-shell/shared";

import { sanitizeIdent } from "./ddlTemplates.js";
import { listTables } from "./schemaService.js";

export interface LocationAnalysis {
  plan: LocationPlan;
  findings: Finding[];
}

export interface LocationSource {
  bucket: string;
  key: string;
}

const ARTIFACT_BYTES = 128;

/**
 * Decides where Athena will read from for a new table:
 *   - source outside <prefix>datasets/  → MOVE into datasets/<sanitized-table>/
 *   - source already in datasets/<dir>/ with clean siblings → IN-PLACE
 *   - source already in datasets/<dir>/ with heterogeneous siblings → BLOCK
 *   - proposed final location already hosts a Glue table → BLOCK (replace flow)
 *
 * A file sitting *directly* in /datasets/ (no subdir) is treated as
 * outside for planning purposes — a direct LOCATION=<prefix>datasets/
 * would scan every dataset in the workspace at query time.
 */
export async function analyzeLocation(
  s3: S3Client,
  glue: GlueClient,
  ctx: AuthContext,
  source: LocationSource,
  requestedTable: string
): Promise<LocationAnalysis> {
  assertScoped(ctx, source);
  const datasetsPrefix = `${ctx.s3.prefix}datasets/`;
  const isInsideDatasetsSubdir =
    source.key.startsWith(datasetsPrefix) &&
    source.key.slice(datasetsPrefix.length).includes("/");

  if (!isInsideDatasetsSubdir) {
    return planOutside(glue, ctx, requestedTable, datasetsPrefix);
  }
  return planInside(s3, glue, ctx, source);
}

async function planOutside(
  glue: GlueClient,
  ctx: AuthContext,
  requestedTable: string,
  datasetsPrefix: string
): Promise<LocationAnalysis> {
  const tableSlug = sanitizeIdent(requestedTable) || "dataset";
  const targetDir = `${datasetsPrefix}${tableSlug}/`;
  const finalLocation = `s3://${ctx.s3.bucket}/${targetDir}`;
  const dup = await findDuplicateTable(glue, ctx, finalLocation);
  if (dup) {
    return {
      plan: {
        strategy: "blocked",
        summary: `Another table (${dup.existingDatabase}.${dup.existingTable}) already points at this location.`,
      },
      findings: [dup],
    };
  }
  return {
    plan: {
      strategy: "move",
      finalLocation,
      summary: `Move source into ${targetDir}`,
    },
    findings: [],
  };
}

async function planInside(
  s3: S3Client,
  glue: GlueClient,
  ctx: AuthContext,
  source: LocationSource
): Promise<LocationAnalysis> {
  const parentDir = source.key.slice(0, source.key.lastIndexOf("/") + 1);
  const finalLocation = `s3://${ctx.s3.bucket}/${parentDir}`;
  const dup = await findDuplicateTable(glue, ctx, finalLocation);
  if (dup) {
    return {
      plan: {
        strategy: "blocked",
        summary: `Another table (${dup.existingDatabase}.${dup.existingTable}) already points at this location.`,
      },
      findings: [dup],
    };
  }
  const mixed = await detectMixedParent(s3, source, parentDir);
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
      summary: `Register in place — source is already in a clean dataset folder.`,
    },
    findings: [],
  };
}

async function findDuplicateTable(
  glue: GlueClient,
  ctx: AuthContext,
  finalLocation: string
): Promise<DuplicateTableFinding | null> {
  const userDatabase = ctx.athena.userDatabase;
  if (!userDatabase) return null;
  let nextToken: string | undefined;
  const normalizedTarget = normalizeS3Url(finalLocation);
  do {
    let page;
    try {
      page = await listTables(glue, userDatabase, nextToken);
    } catch {
      // Database not created yet → no existing tables; proceed.
      return null;
    }
    for (const t of page.items) {
      if (!t.location) continue;
      if (normalizeS3Url(t.location) === normalizedTarget) {
        return {
          kind: "duplicate-table",
          severity: "block",
          message: `${userDatabase}.${t.name} already references ${finalLocation}.`,
          existingDatabase: userDatabase,
          existingTable: t.name,
          existingLocation: t.location,
        };
      }
    }
    nextToken = page.nextToken;
  } while (nextToken);
  return null;
}

async function detectMixedParent(
  s3: S3Client,
  source: LocationSource,
  parentDir: string
): Promise<MixedParentFinding | null> {
  const out = await s3.send(
    new ListObjectsV2Command({
      Bucket: source.bucket,
      Prefix: parentDir,
      Delimiter: "/",
    })
  );
  const sourceExt = extensionOf(source.key);
  const siblings: { key: string; size: number }[] = [];
  for (const obj of out.Contents ?? []) {
    if (!obj.Key || obj.Key === parentDir) continue;
    if (obj.Key.endsWith("/")) continue;
    siblings.push({ key: obj.Key, size: obj.Size ?? 0 });
  }
  const bad = siblings.filter(
    (s) => extensionOf(s.key) !== sourceExt || s.size < ARTIFACT_BYTES
  );
  if (bad.length === 0) return null;
  return {
    kind: "mixed-parent",
    severity: "block",
    message: `${siblings.length} file(s) in this folder — ${bad.length} don't match.`,
    parentPrefix: parentDir,
    siblingFileNames: bad.slice(0, 20).map((s) => basenameOf(s.key)),
  };
}

function assertScoped(ctx: AuthContext, source: LocationSource): void {
  if (source.bucket !== ctx.s3.bucket) {
    throw new Error("source bucket does not match workspace bucket");
  }
  if (!source.key.startsWith(ctx.s3.prefix)) {
    throw new Error("source key is outside workspace prefix");
  }
  if (source.key.includes("..")) {
    throw new Error("source key contains path traversal");
  }
}

function basenameOf(key: string): string {
  const i = key.lastIndexOf("/");
  return i === -1 ? key : key.slice(i + 1);
}

function extensionOf(key: string): string {
  const base = basenameOf(key).toLowerCase();
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1);
}

function normalizeS3Url(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
