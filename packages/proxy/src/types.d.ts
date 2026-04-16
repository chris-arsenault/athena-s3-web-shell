import type { AuthContext } from "@athena-shell/shared";

declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
      requestId?: string;
    }
  }
}

export {};
