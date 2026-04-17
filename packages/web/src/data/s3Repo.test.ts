import { describe, expect, it } from "vitest";

import type { AuthContext, AwsTempCredentials } from "@athena-shell/shared";

import type { AuthProvider } from "../auth/AuthProvider";
import { buildS3ClientConfig } from "./s3Repo";

const stubProvider: AuthProvider = {
  isMock: () => false,
  async getContext() {
    throw new Error("stub");
  },
  async getCredentials(): Promise<AwsTempCredentials> {
    return {
      accessKeyId: "AKIA",
      secretAccessKey: "SECRET",
      sessionToken: "TOKEN",
      expiration: "2099-01-01T00:00:00Z",
    };
  },
  async getProxyAuthHeader() {
    return null;
  },
  async signOut() {},
};

const stubContext: AuthContext = {
  userId: "u",
  displayName: "u",
  email: "u@example.com",
  region: "us-east-1",
  roleArn: "arn:aws:iam::0:role/u",
  s3: { bucket: "b", prefix: "users/u/" },
  athena: { workgroup: "wg", outputLocation: "s3://b/" },
};

describe("buildS3ClientConfig", () => {
  /**
   * REGRESSION GUARD. @aws-sdk/client-s3 >= 3.729 defaults
   * requestChecksumCalculation to "WHEN_SUPPORTED", which attaches a
   * CRC32 to CreateMultipartUpload and then requires ChecksumCRC32 on
   * every UploadPart. lib-storage's Upload class does not reliably
   * set that per-part header, so multipart uploads above 5 MB fail
   * with:
   *
   *   "The upload was created using a crc32 checksum. The complete
   *    request must include the checksum for each part. It was
   *    missing for part 1 in the request."
   *
   * Forcing "WHEN_REQUIRED" reverts to legacy behavior — only attach
   * a checksum when the operation mandates it (multipart does not).
   *
   * If you find yourself reading this because the assertion failed:
   * do NOT loosen this test. The default value is the bug. Look at
   * the SDK changelog + lib-storage issue tracker to confirm the
   * upstream fix landed before changing the client config.
   */
  it("sets requestChecksumCalculation to WHEN_REQUIRED to prevent the CRC32 multipart bug", () => {
    const cfg = buildS3ClientConfig(stubProvider, stubContext);
    expect(cfg.requestChecksumCalculation).toBe("WHEN_REQUIRED");
  });

  it("uses the auth context's region", () => {
    const cfg = buildS3ClientConfig(stubProvider, { ...stubContext, region: "eu-west-1" });
    expect(cfg.region).toBe("eu-west-1");
  });
});
