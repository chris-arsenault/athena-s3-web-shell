import type { Request } from "express";
import { MOCK_USER_HEADER, type AuthContext } from "@athena-shell/shared";

import { UnauthorizedError, type AuthProvider } from "./authProvider.js";

export class MockAuthProvider implements AuthProvider {
  constructor(private readonly users: Record<string, AuthContext>) {}

  async resolve(req: Request): Promise<AuthContext> {
    const headerVal = req.header(MOCK_USER_HEADER);
    const userId =
      headerVal ?? Object.keys(this.users)[0] ?? throwMissingDefault();
    const user = this.users[userId];
    if (!user) throw new UnauthorizedError(`Unknown mock user: ${userId}`);
    return user;
  }
}

function throwMissingDefault(): never {
  throw new UnauthorizedError("No mock users configured");
}
