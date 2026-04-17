import express from "express";
import morgan from "morgan";

import type { ProxyConfig } from "./config.js";
import { authenticate } from "./middleware/authenticate.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestId } from "./middleware/requestId.js";
import { datasetsRouter } from "./routes/datasets.js";
import { healthRouter } from "./routes/health.js";
import { sessionRouter } from "./routes/session.js";
import { schemaRouter } from "./routes/schema.js";
import { queryRouter } from "./routes/query.js";
import { historyRouter } from "./routes/history.js";
import { resultsRouter } from "./routes/results.js";
import { savedQueriesRouter } from "./routes/savedQueries.js";
import { mountSpa } from "./static/serveSpa.js";

// Register a morgan token for the request id so HTTP access logs can
// be joined against audit events on the same field.
morgan.token("rid", (req) => (req as express.Request).requestId ?? "-");

// morgan's "combined" format + a leading [rid] so CloudWatch Logs
// Insights joins trivially against audit events.
const MORGAN_FORMAT =
  '[:rid] :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';

export function createServer(config: ProxyConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Behind ahara's ALB. Makes req.ip the real client IP (leftmost
  // X-Forwarded-For entry) instead of the ALB's VPC interface.
  app.set("trust proxy", true);

  app.use(requestId());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan(MORGAN_FORMAT));

  app.use("/api/health", healthRouter());

  const apiAuth = express.Router();
  apiAuth.use(authenticate(config));
  apiAuth.use("/session", sessionRouter());
  apiAuth.use("/schema", schemaRouter(config));
  apiAuth.use("/query", queryRouter(config));
  apiAuth.use("/query", resultsRouter(config));
  apiAuth.use("/history", historyRouter(config));
  apiAuth.use("/datasets", datasetsRouter(config));
  apiAuth.use("/saved-queries", savedQueriesRouter(config));
  app.use("/api", apiAuth);

  if (config.staticDir) mountSpa(app, config.staticDir);

  app.use(errorHandler);
  return app;
}
