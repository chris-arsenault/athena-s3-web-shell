import { Router } from "express";

import type { ProxyConfig } from "../config.js";
import { createGlueClient } from "../aws/glueClient.js";
import { getTable, listDatabases, listTables } from "../services/schemaService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export function schemaRouter(config: ProxyConfig): Router {
  const r = Router();
  const glue = createGlueClient(config);

  r.get(
    "/databases",
    asyncHandler(async (req, res) => {
      const page = await listDatabases(glue, req.query.nextToken as string | undefined);
      res.json(page);
    })
  );

  r.get(
    "/databases/:db/tables",
    asyncHandler(async (req, res) => {
      const page = await listTables(
        glue,
        req.params.db!,
        req.query.nextToken as string | undefined
      );
      res.json(page);
    })
  );

  r.get(
    "/databases/:db/tables/:table",
    asyncHandler(async (req, res) => {
      const detail = await getTable(glue, req.params.db!, req.params.table!);
      res.json(detail);
    })
  );

  return r;
}
