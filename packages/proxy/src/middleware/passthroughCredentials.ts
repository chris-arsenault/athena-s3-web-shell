import type { RequestHandler } from "express";

import {
  AWS_ACCESS_KEY_HEADER,
  AWS_SECRET_KEY_HEADER,
  AWS_SESSION_TOKEN_HEADER,
} from "@athena-shell/shared";

import type { ProxyConfig } from "../config.js";
import { UnauthorizedError } from "../auth/authProvider.js";

export interface PassthroughCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

/**
 * Pulls the caller's STS credentials off the request headers and attaches
 * them to `req.awsCredentials`. The per-request AWS SDK clients read from
 * there so every Athena/Glue call runs under the caller's own IAM role.
 *
 * In `alb` mode the headers are mandatory — the SPA is expected to fetch
 * them from the Identity Pool and attach them to every /api request. We
 * reject early rather than letting the SDK fall back to the task role.
 *
 * In `mock` mode the headers are optional; the proxy doesn't hit AWS
 * during mock-backed dev, so absent creds are harmless. Tests that bypass
 * auth already seed fake clients directly on the request.
 */
export function passthroughCredentials(config: ProxyConfig): RequestHandler {
  const required = config.authProvider === "alb";
  return (req, _res, next) => {
    const accessKeyId = req.header(AWS_ACCESS_KEY_HEADER);
    const secretAccessKey = req.header(AWS_SECRET_KEY_HEADER);
    const sessionToken = req.header(AWS_SESSION_TOKEN_HEADER);
    if (accessKeyId && secretAccessKey && sessionToken) {
      req.awsCredentials = { accessKeyId, secretAccessKey, sessionToken };
      return next();
    }
    if (required) {
      return next(
        new UnauthorizedError(
          "Missing AWS passthrough credentials — SPA must send the three x-aws-* headers."
        )
      );
    }
    next();
  };
}
