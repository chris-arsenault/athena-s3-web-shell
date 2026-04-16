import type { Request } from "express";
import type { AuthContext } from "@athena-shell/shared";

export interface AuthProvider {
  resolve(req: Request): Promise<AuthContext>;
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
