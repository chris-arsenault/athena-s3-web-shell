import { Router } from "express";

import type { AuthContext, DatasetFileType } from "@athena-shell/shared";

import { createAthenaClient } from "../aws/athenaClient.js";
import { createS3Client } from "../aws/s3Client.js";
import type { ProxyConfig } from "../config.js";
import { createTable, inferSchema } from "../services/datasetsService.js";
import { sanitizeIdent } from "../services/ddlTemplates.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const SUPPORTED_FILE_TYPES: ReadonlySet<DatasetFileType> = new Set([
  "csv",
  "tsv",
  "json",
  "jsonl",
  "parquet",
]);

export function datasetsRouter(config: ProxyConfig): Router {
  const r = Router();
  const s3 = createS3Client(config);
  const athena = createAthenaClient(config);

  r.post(
    "/infer",
    asyncHandler(async (req, res) => {
      const params = parseInferBody(req.body);
      if (!params.bucket || !params.key || !SUPPORTED_FILE_TYPES.has(params.fileType)) {
        res.status(400).json({
          error: { message: "bucket, key, and supported fileType are required" },
        });
        return;
      }
      const user = req.user!;
      if (!isWithinUserScope(user.s3.bucket, user.s3.prefix, params.bucket, params.key)) {
        res.status(403).json({ error: { message: "Path outside workspace prefix" } });
        return;
      }
      const response = await inferSchema(
        s3,
        params.bucket,
        params.key,
        params.fileType,
        params.sampleBytes
      );
      res.json(response);
    })
  );

  r.post(
    "/create-table",
    asyncHandler(async (req, res) => {
      const { valid, error } = validateCreateTable(req.body, req.user!);
      if (!valid) {
        res.status(error!.status).json({ error: { message: error!.message } });
        return;
      }
      const payload = req.body;
      const response = await createTable(athena, req.user!.athena, {
        database: sanitizeIdent(payload.database),
        table: sanitizeIdent(payload.table),
        location: payload.location,
        fileType: payload.fileType,
        columns: payload.columns,
        skipHeader: payload.skipHeader ?? true,
      });
      res.json(response);
    })
  );

  return r;
}

interface InferBody {
  bucket: string;
  key: string;
  fileType: DatasetFileType;
  sampleBytes: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseInferBody(body: any): InferBody {
  const b = body ?? {};
  return {
    bucket: String(b.bucket ?? "").trim(),
    key: String(b.key ?? "").trim(),
    fileType: String(b.fileType ?? "").toLowerCase() as DatasetFileType,
    sampleBytes: Number(b.sampleBytes ?? 65536),
  };
}

type Err = { status: number; message: string };
type ValidationResult = { valid: boolean; error?: Err };

function fail(status: number, message: string): ValidationResult {
  return { valid: false, error: { status, message } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateCreateTable(body: any, user: AuthContext): ValidationResult {
  if (!body || typeof body !== "object") return fail(400, "body is required");
  const shapeErr = validateShape(body);
  if (shapeErr) return fail(400, shapeErr);
  if (body.database !== user.athena.userDatabase) {
    return fail(403, "database must be the caller's userDatabase");
  }
  if (!isLocationWithinUserScope(user.s3.bucket, user.s3.prefix, String(body.location))) {
    return fail(403, "location outside workspace prefix");
  }
  return { valid: true };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateShape(body: any): string | null {
  if (!body.database || !body.table || !body.location) {
    return "database, table, location are required";
  }
  if (!SUPPORTED_FILE_TYPES.has(body.fileType)) {
    return `Unsupported fileType: ${body.fileType}`;
  }
  if (!Array.isArray(body.columns) || body.columns.length === 0) {
    return "columns must be non-empty";
  }
  return null;
}

function isWithinUserScope(
  userBucket: string,
  userPrefix: string,
  bucket: string,
  key: string
): boolean {
  if (bucket !== userBucket) return false;
  if (key.includes("..")) return false;
  return key.startsWith(userPrefix);
}

function isLocationWithinUserScope(
  userBucket: string,
  userPrefix: string,
  location: string
): boolean {
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(location);
  if (!m) return false;
  return isWithinUserScope(userBucket, userPrefix, m[1]!, m[2]!);
}
