import { Router } from "express";

import { createAthenaClient } from "../aws/athenaClient.js";
import { createS3Client } from "../aws/s3Client.js";
import type { ProxyConfig } from "../config.js";
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
      res.json({ url });
    })
  );

  return r;
}
