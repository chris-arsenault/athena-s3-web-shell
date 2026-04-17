import { Router } from "express";

import type { AuthContext } from "@athena-shell/shared";

import { createAthenaClient } from "../aws/athenaClient.js";
import { createS3Client } from "../aws/s3Client.js";
import type { ProxyConfig } from "../config.js";
import { audit } from "../services/audit.js";
import {
  copyResultToWorkspace,
  HttpError,
} from "../services/queryResultsService.js";
import { getQuery } from "../services/queryService.js";
import { presignResultsDownload } from "../services/resultsService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function resultsRouter(config: ProxyConfig): Router {
  const r = Router();
  const athena = createAthenaClient(config);
  const s3 = createS3Client(config);

  r.get(
    "/:id/download",
    asyncHandler(async (req, res) => {
      const status = await getQuery(athena, req.params.id!);
      if (!status.outputLocation) {
        res.status(404).json({ error: { message: "Query has no output location yet" } });
        return;
      }
      const url = await presignResultsDownload(s3, status.outputLocation);
      audit.queryDownload(req, {
        executionId: req.params.id!,
        outputLocation: status.outputLocation,
      });
      res.json({ url });
    })
  );

  r.get(
    "/:id/results-url",
    asyncHandler(async (req, res) => {
      const status = await getQuery(athena, req.params.id!);
      if (!status.outputLocation) {
        res.status(404).json({ error: { message: "Query has no output location yet" } });
        return;
      }
      const url = await presignResultsDownload(s3, status.outputLocation);
      audit.queryS3ResultsFetch(req, {
        executionId: req.params.id!,
        outputLocation: status.outputLocation,
      });
      res.json({ url });
    })
  );

  r.post(
    "/:id/save-to-workspace",
    asyncHandler(async (req, res) => {
      const user = req.user!;
      const parsed = parseSaveBody(req.body, user);
      if (parsed.error) {
        res.status(parsed.status!).json({ error: { message: parsed.error } });
        return;
      }
      try {
        const out = await copyResultToWorkspace(athena, s3, req.params.id!, parsed.value!);
        audit.querySaveToWorkspace(req, {
          executionId: req.params.id!,
          targetKey: out.targetKey,
          includeSqlSidecar: !!out.sidecarKey,
        });
        res.json({
          key: out.targetKey,
          sidecarKey: out.sidecarKey,
        });
      } catch (e) {
        if (e instanceof HttpError) {
          res.status(e.status).json({ error: { message: e.message } });
          return;
        }
        throw e;
      }
    })
  );

  return r;
}

interface SaveBody {
  targetBucket: string;
  targetKey: string;
  includeSqlSidecar: boolean;
  overwrite: boolean;
}

interface SaveParseResult {
  value?: SaveBody;
  error?: string;
  status?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSaveBody(body: any, user: AuthContext): SaveParseResult {
  if (!body || typeof body !== "object") return { error: "body is required", status: 400 };
  const targetKey = String(body.targetKey ?? "").trim();
  if (!targetKey) return { error: "targetKey is required", status: 400 };
  if (targetKey.includes("..")) {
    return { error: "targetKey contains path traversal", status: 403 };
  }
  if (!targetKey.startsWith(user.s3.prefix)) {
    return { error: "targetKey outside workspace prefix", status: 403 };
  }
  return {
    value: {
      targetBucket: user.s3.bucket,
      targetKey,
      includeSqlSidecar: body.includeSqlSidecar !== false,
      overwrite: body.overwrite === true,
    },
  };
}
