import { describe, expect, it } from "vitest";

import { basenameOf, isWithinPrefix, joinPrefix, parseS3Path } from "./parseS3Path";

describe("parseS3Path", () => {
  it("parses bucket and key", () => {
    expect(parseS3Path("s3://b/foo/bar.csv")).toEqual({ bucket: "b", key: "foo/bar.csv" });
  });
  it("rejects non-s3", () => {
    expect(() => parseS3Path("http://x")).toThrow();
  });
});

describe("joinPrefix", () => {
  it("joins and ensures trailing slash", () => {
    expect(joinPrefix("users", "dev", "data")).toBe("users/dev/data/");
    expect(joinPrefix("users/", "/dev/")).toBe("users/dev/");
    expect(joinPrefix()).toBe("");
  });
});

describe("basenameOf", () => {
  it("strips path and trailing slash", () => {
    expect(basenameOf("a/b/c.txt")).toBe("c.txt");
    expect(basenameOf("a/b/dir/")).toBe("dir");
    expect(basenameOf("file")).toBe("file");
  });
});

describe("isWithinPrefix", () => {
  it("requires prefix and rejects ..", () => {
    expect(isWithinPrefix("users/dev/file.csv", "users/dev/")).toBe(true);
    expect(isWithinPrefix("users/other/file.csv", "users/dev/")).toBe(false);
    expect(isWithinPrefix("users/dev/../escape", "users/dev/")).toBe(false);
  });
});
