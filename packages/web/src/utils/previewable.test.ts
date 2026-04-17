import { describe, expect, it } from "vitest";

import { isPreviewable, previewKind } from "./previewable";

describe("previewKind", () => {
  it.each([
    ["hello.txt", "text"],
    ["README.md", "text"],
    ["script.sql", "text"],
    ["photo.png", "image"],
    ["photo.JPG", "image"],
    ["anim.gif", "image"],
    ["hero.webp", "image"],
    ["rows.csv", "csv"],
    ["rows.tsv", "tsv"],
    ["events.jsonl", "jsonl"],
    ["events.ndjson", "jsonl"],
    ["config.json", "json"],
    ["data.parquet", "parquet"],
    ["archive.zip", "none"],
    ["noext", "none"],
  ])("dispatches %s to %s", (name, kind) => {
    expect(previewKind(name)).toBe(kind);
  });
});

describe("isPreviewable", () => {
  it("is true for every non-none kind", () => {
    expect(isPreviewable("a.txt")).toBe(true);
    expect(isPreviewable("a.png")).toBe(true);
    expect(isPreviewable("a.parquet")).toBe(true);
    expect(isPreviewable("a.zip")).toBe(false);
  });
});
