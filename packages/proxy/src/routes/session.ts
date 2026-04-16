import { Router } from "express";

export function sessionRouter(): Router {
  const r = Router();
  r.get("/", (req, res) => {
    res.json(req.user);
  });
  return r;
}
