import { GlueClient } from "@aws-sdk/client-glue";

import type { ProxyConfig } from "../config.js";

export function createGlueClient(config: ProxyConfig): GlueClient {
  return new GlueClient({ region: config.region });
}
