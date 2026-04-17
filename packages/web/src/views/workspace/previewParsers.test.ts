import { describe, expect, it } from "vitest";

import {
  isFailure,
  parseDelimited,
  parseJsonLines,
  parseJsonTree,
  type ParsedTable,
  type ParseFailure,
} from "./previewParsers";

function asTable(r: ParsedTable | ParseFailure): ParsedTable {
  if (isFailure(r)) throw new Error(`expected a ParsedTable, got ${r.error}`);
  return r;
}

describe("parseDelimited", () => {
  it("pulls header + rows from a small csv", () => {
    const r = asTable(parseDelimited("a,b,c\n1,2,3\n4,5,6\n", ","));
    expect(r.columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("supports tsv", () => {
    const r = asTable(parseDelimited("a\tb\n1\t2\n", "\t"));
    expect(r.columns.map((c) => c.name)).toEqual(["a", "b"]);
    expect(r.rows).toEqual([["1", "2"]]);
  });

  it("synthesizes column names when header cells are empty", () => {
    const r = asTable(parseDelimited(",,\n1,2,3\n", ","));
    expect(r.columns.map((c) => c.name)).toEqual(["col_1", "col_2", "col_3"]);
  });
});

describe("parseJsonLines", () => {
  it("unions keys across records, preserving first-seen order", () => {
    const r = asTable(
      parseJsonLines(`
        {"a": 1, "b": 2}
        {"b": 3, "c": 4}
      `)
    );
    expect(r.columns.map((c) => c.name)).toEqual(["a", "b", "c"]);
    expect(r.rows).toEqual([
      ["1", "2", ""],
      ["", "3", "4"],
    ]);
  });

  it("stringifies nested values", () => {
    const r = asTable(parseJsonLines('{"x": [1,2]}\n{"x": null}'));
    expect(r.rows[0]?.[0]).toBe("[1,2]");
    expect(r.rows[1]?.[0]).toBe("");
  });

  it("returns a failure on malformed input", () => {
    const r = parseJsonLines("{not json}\n");
    expect(isFailure(r)).toBe(true);
  });
});

describe("parseJsonTree", () => {
  it("parses objects to obj nodes with ordered entries", () => {
    const r = parseJsonTree('{"a":1,"b":"hi","c":null}');
    if (isFailure(r)) throw new Error("parse failed");
    expect(r.root.kind).toBe("obj");
    if (r.root.kind !== "obj") return;
    expect(r.root.entries.map(([k]) => k)).toEqual(["a", "b", "c"]);
  });

  it("parses arrays", () => {
    const r = parseJsonTree("[1, true, null]");
    if (isFailure(r)) throw new Error("parse failed");
    expect(r.root.kind).toBe("arr");
    if (r.root.kind !== "arr") return;
    expect(r.root.items).toHaveLength(3);
  });

  it("returns a failure on malformed json", () => {
    expect(isFailure(parseJsonTree("{not json"))).toBe(true);
  });
});
