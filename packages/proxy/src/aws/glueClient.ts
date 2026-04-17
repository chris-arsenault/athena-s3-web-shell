import { GlueClient } from "@aws-sdk/client-glue";

import type { ProxyConfig } from "../config.js";
import type { PassthroughCredentials } from "../middleware/passthroughCredentials.js";

export function createGlueClient(
  config: ProxyConfig,
  credentials?: PassthroughCredentials
): GlueClient {
  return new GlueClient({
    region: config.region,
    ...(credentials ? { credentials } : {}),
  });
}
