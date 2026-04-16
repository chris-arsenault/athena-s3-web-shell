import type { RequestHandler } from "express";

import type { ProxyConfig } from "../config.js";
import type { AuthProvider } from "../auth/authProvider.js";
import { CognitoAuthProvider } from "../auth/cognitoAuthProvider.js";
import { MockAuthProvider } from "../auth/mockAuthProvider.js";

export function authenticate(config: ProxyConfig): RequestHandler {
  const provider: AuthProvider = config.mockAuth
    ? new MockAuthProvider(config.mockUsers)
    : new CognitoAuthProvider();
  return (req, _res, next) => {
    provider
      .resolve(req)
      .then((user) => {
        req.user = user;
        next();
      })
      .catch(next);
  };
}
