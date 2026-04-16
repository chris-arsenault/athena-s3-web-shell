import express from "express";
import morgan from "morgan";

import type { ProxyConfig } from "./config.js";
import { authenticate } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { datasetsRouter } from "./routes/datasets.js";
import { healthRouter } from "./routes/health.js";
import { sessionRouter } from "./routes/session.js";
import { schemaRouter } from "./routes/schema.js";
import { queryRouter } from "./routes/query.js";
import { historyRouter } from "./routes/history.js";
import { resultsRouter } from "./routes/results.js";
import { mountSpa } from "./static/serveSpa.js";

export function createServer(config: ProxyConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("combined"));

  app.use("/api/health", healthRouter());

  const apiAuth = express.Router();
  apiAuth.use(authenticate(config));
  apiAuth.use("/session", sessionRouter());
  apiAuth.use("/schema", schemaRouter(config));
  apiAuth.use("/query", queryRouter(config));
  apiAuth.use("/query", resultsRouter(config));
  apiAuth.use("/history", historyRouter(config));
  apiAuth.use("/datasets", datasetsRouter(config));
  app.use("/api", apiAuth);

  if (config.staticDir) mountSpa(app, config.staticDir);

  app.use(errorHandler);
  return app;
}
