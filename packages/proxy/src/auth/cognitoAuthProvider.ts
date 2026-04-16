import type { Request } from "express";
import type { AuthContext } from "@athena-shell/shared";

import { UnauthorizedError, type AuthProvider } from "./authProvider.js";

export class CognitoAuthProvider implements AuthProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(_req: Request): Promise<AuthContext> {
    throw new UnauthorizedError(
      "CognitoAuthProvider not yet implemented. Wire aws-jwt-verify + JWKS + AssumeRoleWithWebIdentity in v2."
    );
  }
}
