import type {
  CreateTableRequest,
  CreateTableResponse,
  DatasetFileType,
  InferSchemaRequest,
  InferSchemaResponse,
} from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { apiPost } from "./api";
import { mockDatasets } from "./mockDatasets";

async function authHeader(provider: AuthProvider) {
  return provider.getProxyAuthHeader();
}

export async function inferSchema(
  provider: AuthProvider,
  req: InferSchemaRequest
): Promise<InferSchemaResponse> {
  if (provider.isMock()) return mockDatasets.inferSchema(req);
  return apiPost("/datasets/infer", req, { authHeader: await authHeader(provider) });
}

export async function createTable(
  provider: AuthProvider,
  req: CreateTableRequest
): Promise<CreateTableResponse> {
  if (provider.isMock()) return mockDatasets.createTable(req);
  return apiPost("/datasets/create-table", req, { authHeader: await authHeader(provider) });
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
