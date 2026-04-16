import type { RequestHandler } from "express";

import type { ProxyConfig } from "../config.js";
import type { AuthProvider } from "../auth/authProvider.js";
import { AlbAuthProvider } from "../auth/albAuthProvider.js";
import { MockAuthProvider } from "../auth/mockAuthProvider.js";

export function authenticate(config: ProxyConfig): RequestHandler {
  const provider = buildProvider(config);
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

function buildProvider(config: ProxyConfig): AuthProvider {
  if (config.authProvider === "alb") {
    if (!config.alb) {
      throw new Error("alb provider selected but no alb settings in config");
    }
    return new AlbAuthProvider({
      region: config.region,
      accountId: config.alb.accountId,
      namePrefix: config.alb.namePrefix,
      dataBucket: config.alb.dataBucket,
      resultsBucket: config.alb.resultsBucket,
      glueDatabase: config.alb.glueDatabase,
    });
  }
  return new MockAuthProvider(config.mockUsers);
}
