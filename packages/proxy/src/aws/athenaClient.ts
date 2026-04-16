import { AthenaClient } from "@aws-sdk/client-athena";

import type { ProxyConfig } from "../config.js";

export function createAthenaClient(config: ProxyConfig): AthenaClient {
  return new AthenaClient({ region: config.region });
}
