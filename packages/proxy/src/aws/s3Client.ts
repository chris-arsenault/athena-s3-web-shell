import { S3Client } from "@aws-sdk/client-s3";

import type { ProxyConfig } from "../config.js";
import type { PassthroughCredentials } from "../middleware/passthroughCredentials.js";

export function createS3Client(
  config: ProxyConfig,
  credentials?: PassthroughCredentials
): S3Client {
  return new S3Client({
    region: config.region,
    ...(credentials ? { credentials } : {}),
  });
}
