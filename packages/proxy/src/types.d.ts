import type { AuthContext } from "@athena-shell/shared";

import type { PassthroughCredentials } from "./middleware/passthroughCredentials.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
      requestId?: string;
      awsCredentials?: PassthroughCredentials;
    }
  }
}

export {};
