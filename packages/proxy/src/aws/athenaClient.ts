import { AthenaClient } from "@aws-sdk/client-athena";

import type { ProxyConfig } from "../config.js";
import type { PassthroughCredentials } from "../middleware/passthroughCredentials.js";

export function createAthenaClient(
  config: ProxyConfig,
  credentials?: PassthroughCredentials
): AthenaClient {
  return new AthenaClient({
    region: config.region,
    ...(credentials ? { credentials } : {}),
  });
}
