import type { GlueClient } from "@aws-sdk/client-glue";
import type { S3Client } from "@aws-sdk/client-s3";

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AuthContext,
  Finding,
} from "@athena-shell/shared";

import {
  DEFAULT_SAMPLE_BYTES,
  fetchSampleText,
  inferSchema,
  inferSchemaFromText,
} from "./datasetsService.js";
import {
  detectJsonArray,
  detectNullTokens,
  detectSerdeMismatch,
  detectTypeMismatches,
} from "./findingsDetector.js";
import { analyzeLocation } from "./locationAnalyzer.js";

/**
 * Runs schema inference + location analysis + data-shape findings in
 * one pass. The SPA renders the result as the modal's review state.
 *
 * Single S3 round-trip for non-parquet files: fetch the sample text
 * once, hand it to both inference and the findings detectors that
 * work off raw text (json-array, serde-mismatch).
 */
export async function analyzeDataset(
  s3: S3Client,
  glue: GlueClient,
  ctx: AuthContext,
  req: AnalyzeRequest
): Promise<AnalyzeResponse> {
  const { bucket, key, fileType, table } = req;

  let sampleText: string | null = null;
  let inference;
  if (fileType === "parquet") {
    inference = await inferSchema(s3, bucket, key, fileType);
  } else {
    sampleText = await fetchSampleText(s3, bucket, key, DEFAULT_SAMPLE_BYTES);
    inference = inferSchemaFromText(sampleText, fileType);
  }

  const location = await analyzeLocation(s3, glue, ctx, { bucket, key }, table);

  const findings: Finding[] = [...location.findings];
  const jsonArray = detectJsonArray(fileType, sampleText);
  if (jsonArray) findings.push(jsonArray);

  findings.push(...detectTypeMismatches(inference.columns, inference.sampleRows));
  findings.push(...detectNullTokens(inference.columns, inference.sampleRows));

  const serde = detectSerdeMismatch(fileType, sampleText, inference.fieldDelimiter);
  if (serde) findings.push(serde);

  return {
    columns: inference.columns,
    sampleRows: inference.sampleRows,
    fieldDelimiter: inference.fieldDelimiter,
    hasHeader: inference.hasHeader,
    location: location.plan,
    findings,
  };
}
