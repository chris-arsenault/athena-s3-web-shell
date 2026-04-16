import { S3Client } from "@aws-sdk/client-s3";

import type { ProxyConfig } from "../config.js";

export function createS3Client(config: ProxyConfig): S3Client {
  return new S3Client({ region: config.region });
}
