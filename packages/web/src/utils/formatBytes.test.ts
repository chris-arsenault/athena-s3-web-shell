import { describe, expect, it } from "vitest";

import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1, "1 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [10 * 1024 * 1024, "10.0 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
  ])("formats %i as %s", (n, expected) => {
    expect(formatBytes(n)).toBe(expected);
  });

  it("returns em dash for invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });
});
