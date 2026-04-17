import { Router, type Request } from "express";

import { HISTORY_PAGE_SIZE } from "@athena-shell/shared";

import { createAthenaClient } from "../aws/athenaClient.js";
import type { ProxyConfig } from "../config.js";
import { listHistory } from "../services/historyService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function historyRouter(config: ProxyConfig): Router {
  const r = Router();
  const athena = (req: Request) => createAthenaClient(config, req.awsCredentials);

  r.get(
    "/",
    asyncHandler(async (req, res) => {
      const page = await listHistory(
        athena(req),
        req.user!.athena.workgroup,
        Number(req.query.pageSize ?? HISTORY_PAGE_SIZE),
        req.query.nextToken as string | undefined
      );
      res.json(page);
    })
  );

  return r;
}
