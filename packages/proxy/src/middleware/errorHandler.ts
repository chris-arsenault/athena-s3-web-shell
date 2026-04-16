import type { ErrorRequestHandler } from "express";

interface StatusError extends Error {
  status?: number;
  statusCode?: number;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const e = err as StatusError;
  const status = e.status ?? e.statusCode ?? 500;
  if (status >= 500) console.error("[proxy error]", err);
  res.status(status).json({
    error: { name: e.name ?? "Error", message: e.message ?? "Internal error" },
  });
};
