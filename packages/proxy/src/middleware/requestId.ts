import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const INBOUND_HEADER = "x-request-id";
const OUTBOUND_HEADER = "X-Request-Id";
const MAX_LEN = 64;

// Accept-or-mint request id. If the caller (ALB, upstream proxy, curl)
// already provided one, trust it up to MAX_LEN chars. Otherwise generate
// a uuid. Always surface it on the response so clients can quote it in
// support tickets / error banners, and stick it on req.requestId so
// morgan + audit emitters can include it.
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.header(INBOUND_HEADER);
    const id = (inbound && inbound.slice(0, MAX_LEN)) || randomUUID();
    req.requestId = id;
    res.setHeader(OUTBOUND_HEADER, id);
    next();
  };
}
