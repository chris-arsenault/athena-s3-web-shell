import { Router } from "express";

export function healthRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });
  return r;
}
