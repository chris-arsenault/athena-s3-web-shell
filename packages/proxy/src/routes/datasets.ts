import { Router, type Request, type Response } from "express";

import type {
  AuthContext,
  DatasetFileType,
  TableCreatePlan,
} from "@athena-shell/shared";
import type { AthenaClient } from "@aws-sdk/client-athena";
import type { GlueClient } from "@aws-sdk/client-glue";
import type { S3Client } from "@aws-sdk/client-s3";

import { createAthenaClient } from "../aws/athenaClient.js";
import { createGlueClient } from "../aws/glueClient.js";
import { createS3Client } from "../aws/s3Client.js";
import type { ProxyConfig } from "../config.js";
import { audit } from "../services/audit.js";
import { analyzeDataset } from "../services/analyzeService.js";
import { createTable, createTableFromPlan, inferSchema } from "../services/datasetsService.js";
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
  const s3 = (req: Request) => createS3Client(config, req.awsCredentials);
  const glue = (req: Request) => createGlueClient(config, req.awsCredentials);
  const athena = (req: Request) => createAthenaClient(config, req.awsCredentials);

  r.post("/infer", asyncHandler((req, res) => handleInfer(req, res, s3(req))));
  r.post("/analyze", asyncHandler((req, res) => handleAnalyze(req, res, s3(req), glue(req))));
  r.post(
    "/create-table",
    asyncHandler((req, res) => handleCreateTable(req, res, athena(req)))
  );

  return r;
}

// ---------------------------------------------------------------------------
// Route handlers

async function handleInfer(req: Request, res: Response, s3: S3Client): Promise<void> {
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
  const response = await inferSchema(s3, params.bucket, params.key, params.fileType, params.sampleBytes);
  audit.datasetsInfer(req, {
    bucket: params.bucket,
    key: params.key,
    fileType: params.fileType,
  });
  res.json(response);
}

async function handleAnalyze(
  req: Request,
  res: Response,
  s3: S3Client,
  glue: GlueClient
): Promise<void> {
  const params = parseAnalyzeBody(req.body);
  if (!params.bucket || !params.key || !SUPPORTED_FILE_TYPES.has(params.fileType)) {
    res.status(400).json({
      error: { message: "bucket, key, fileType, and table are required" },
    });
    return;
  }
  const user = req.user!;
  if (!isWithinUserScope(user.s3.bucket, user.s3.prefix, params.bucket, params.key)) {
    res.status(403).json({ error: { message: "Path outside workspace prefix" } });
    return;
  }
  const response = await analyzeDataset(s3, glue, user, params);
  audit.datasetsInfer(req, {
    bucket: params.bucket,
    key: params.key,
    fileType: params.fileType,
  });
  res.json(response);
}

async function handleCreateTable(
  req: Request,
  res: Response,
  athena: AthenaClient
): Promise<void> {
  const user = req.user!;
  if (isPlanBody(req.body)) {
    await createFromPlan(req, res, athena, user);
    return;
  }
  await createFromFlat(req, res, athena, user);
}

async function createFromPlan(
  req: Request,
  res: Response,
  athena: AthenaClient,
  user: AuthContext
): Promise<void> {
  const { valid, error } = validatePlan(req.body, user);
  if (!valid) {
    res.status(error!.status).json({ error: { message: error!.message } });
    return;
  }
  const plan: TableCreatePlan = {
    ...req.body,
    database: sanitizeIdent(req.body.database),
    table: sanitizeIdent(req.body.table),
  };
  const response = await createTableFromPlan(athena, user.athena, plan);
  audit.datasetsCreateTable(req, {
    database: response.database,
    table: response.table,
    location: plan.location.finalLocation ?? "",
    fileType: plan.fileType,
    executionId: response.executionId,
  });
  res.json(response);
}

async function createFromFlat(
  req: Request,
  res: Response,
  athena: AthenaClient,
  user: AuthContext
): Promise<void> {
  const { valid, error } = validateCreateTable(req.body, user);
  if (!valid) {
    res.status(error!.status).json({ error: { message: error!.message } });
    return;
  }
  const payload = req.body;
  const response = await createTable(athena, user.athena, {
    database: sanitizeIdent(payload.database),
    table: sanitizeIdent(payload.table),
    location: payload.location,
    fileType: payload.fileType,
    columns: payload.columns,
    skipHeader: payload.skipHeader ?? true,
  });
  audit.datasetsCreateTable(req, {
    database: response.database,
    table: response.table,
    location: payload.location,
    fileType: payload.fileType,
    executionId: response.executionId,
  });
  res.json(response);
}

// ---------------------------------------------------------------------------
// Body parsing + validation

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

interface AnalyzeBody {
  bucket: string;
  key: string;
  fileType: DatasetFileType;
  table: string;
  sizeBytes?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAnalyzeBody(body: any): AnalyzeBody {
  const b = body ?? {};
  return {
    bucket: String(b.bucket ?? "").trim(),
    key: String(b.key ?? "").trim(),
    fileType: String(b.fileType ?? "").toLowerCase() as DatasetFileType,
    table: String(b.table ?? "").trim(),
    sizeBytes: typeof b.sizeBytes === "number" ? b.sizeBytes : undefined,
  };
}

type Err = { status: number; message: string };
type ValidationResult = { valid: boolean; error?: Err };

function fail(status: number, message: string): ValidationResult {
  return { valid: false, error: { status, message } };
}

function isPlanBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as { location?: unknown };
  return !!b.location && typeof b.location === "object";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validatePlan(body: any, user: AuthContext): ValidationResult {
  if (body.database !== user.athena.userDatabase) {
    return fail(403, "database must be the caller's userDatabase");
  }
  const loc = body.location;
  if (loc.strategy === "blocked") return fail(400, "plan is blocked; resolve findings first");
  if (!loc.finalLocation) return fail(400, "finalLocation is required");
  if (!isLocationWithinUserScope(user.s3.bucket, user.s3.prefix, String(loc.finalLocation))) {
    return fail(403, "location outside workspace prefix");
  }
  if (!SUPPORTED_FILE_TYPES.has(body.fileType)) {
    return fail(400, `Unsupported fileType: ${body.fileType}`);
  }
  if (!Array.isArray(body.columns) || body.columns.length === 0) {
    return fail(400, "columns must be non-empty");
  }
  if (!Array.isArray(body.stringOverrides)) {
    return fail(400, "stringOverrides must be an array");
  }
  return { valid: true };
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
