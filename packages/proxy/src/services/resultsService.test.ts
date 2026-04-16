import { describe, expect, it } from "vitest";

import { parseS3Url } from "./resultsService.js";

describe("parseS3Url", () => {
  it("parses bucket/key", () => {
    expect(parseS3Url("s3://my-bucket/path/to/file.csv")).toEqual({
      bucket: "my-bucket",
      key: "path/to/file.csv",
    });
  });

  it("rejects non-s3 URLs", () => {
    expect(() => parseS3Url("http://example.com/x")).toThrow();
  });
});
