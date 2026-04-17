import type {
  AnalyzeRequest,
  AnalyzeResponse,
  CreateTableRequest,
  CreateTableResponse,
  DatasetFileType,
  InferSchemaRequest,
  InferSchemaResponse,
  TableCreatePlan,
} from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiPost } from "./api";
import { mockDatasets } from "./mockDatasets";
import { proxyHeaders } from "./proxyHeaders";

export async function inferSchema(
  provider: AuthProvider,
  req: InferSchemaRequest
): Promise<InferSchemaResponse> {
  if (provider.isMock()) return mockDatasets.inferSchema(req);
  return apiPost("/datasets/infer", req, { ...(await proxyHeaders(provider)) });
}

export async function analyzeDataset(
  provider: AuthProvider,
  req: AnalyzeRequest
): Promise<AnalyzeResponse> {
  if (provider.isMock()) return mockDatasets.analyze(req);
  return apiPost("/datasets/analyze", req, { ...(await proxyHeaders(provider)) });
}

/** Back-compat flat-request path. Prefer `createTableFromPlan` for new callers. */
export async function createTable(
  provider: AuthProvider,
  req: CreateTableRequest
): Promise<CreateTableResponse> {
  if (provider.isMock()) return mockDatasets.createTable(req);
  return apiPost("/datasets/create-table", req, { ...(await proxyHeaders(provider)) });
}

export async function createTableFromPlan(
  provider: AuthProvider,
  plan: TableCreatePlan
): Promise<CreateTableResponse> {
  if (provider.isMock()) return mockDatasets.createTableFromPlan(plan);
  return apiPost("/datasets/create-table", plan, { ...(await proxyHeaders(provider)) });
}

export function tableFileTypeFor(name: string): DatasetFileType | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (ext === "json") return "json";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "parquet") return "parquet";
  return null;
}
