import { Router } from "express";

import { RESULTS_PAGE_SIZE } from "@athena-shell/shared";

import { createAthenaClient } from "../aws/athenaClient.js";
import type { ProxyConfig } from "../config.js";
import { audit } from "../services/audit.js";
import {
  getQuery,
  getResults,
  startQuery,
  stopQuery,
} from "../services/queryService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function queryRouter(config: ProxyConfig): Router {
  const r = Router();
  const athena = createAthenaClient(config);

  r.post(
    "/",
    asyncHandler(async (req, res) => {
      const sql = String(req.body?.sql ?? "").trim();
      if (!sql) {
        res.status(400).json({ error: { message: "sql is required" } });
        return;
      }
      const result = await startQuery(athena, req.user!.athena, {
        sql,
        database: req.body?.database,
      });
      audit.queryStart(req, {
        sql,
        database: req.body?.database,
        workgroup: req.user!.athena.workgroup,
        executionId: result.executionId,
      });
      res.json(result);
    })
  );

  r.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const status = await getQuery(athena, req.params.id!);
      if (TERMINAL_STATES.has(status.state)) {
        audit.queryEnd(req, {
          executionId: status.executionId,
          state: status.state,
          stateChangeReason: status.stateChangeReason,
          dataScannedBytes: status.stats?.dataScannedBytes,
          totalExecutionMs: status.stats?.totalExecutionMs,
          completedAt: status.completedAt,
        });
      }
      res.json(status);
    })
  );

  r.delete(
    "/:id",
    asyncHandler(async (req, res) => {
      await stopQuery(athena, req.params.id!);
      audit.queryStop(req, { executionId: req.params.id! });
      res.json({ ok: true });
    })
  );

  r.get(
    "/:id/results",
    asyncHandler(async (req, res) => {
      const max = Number(req.query.maxResults ?? RESULTS_PAGE_SIZE);
      const page = await getResults(
        athena,
        req.params.id!,
        req.query.nextToken as string | undefined,
        max
      );
      audit.queryResults(req, {
        executionId: req.params.id!,
        rowCount: page.rows.length,
        hasMore: !!page.nextToken,
      });
      res.json(page);
    })
  );

  return r;
}
