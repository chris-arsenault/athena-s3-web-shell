import { describe, expect, it } from "vitest";

import { locationToPrefix } from "./locationToPrefix";

describe("locationToPrefix", () => {
  it.each([
    ["s3://my-bucket/path/to/dir/", { bucket: "my-bucket", prefix: "path/to/dir/" }],
    ["s3://my-bucket/path/to/dir", { bucket: "my-bucket", prefix: "path/to/dir/" }],
    ["s3://my-bucket/", { bucket: "my-bucket", prefix: "" }],
    ["s3://my-bucket", null],
    ["", null],
    [undefined, null],
    [null, null],
    ["http://not-s3/bucket/", null],
  ])("parses %s", (input, expected) => {
    expect(locationToPrefix(input)).toEqual(expected);
  });

  it("trims leading/trailing whitespace on the input", () => {
    expect(locationToPrefix("  s3://bucket/path/  ")).toEqual({
      bucket: "bucket",
      prefix: "path/",
    });
  });
});
