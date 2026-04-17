import { describe, expect, it } from "vitest";

import type { ResultColumn } from "@athena-shell/shared";

import {
  aggregate,
  allowedAggregations,
  isNumericColumn,
} from "./resultAggregations";

const COLUMNS: ResultColumn[] = [
  { name: "region", type: "varchar" },
  { name: "status", type: "varchar" },
  { name: "bytes", type: "bigint" },
  { name: "ratio", type: "double" },
];

const ROWS: string[][] = [
  ["us-east-1", "ok", "1024", "0.5"],
  ["us-east-1", "fail", "512", "0.1"],
  ["us-east-1", "ok", "256", ""],
  ["eu-west-1", "ok", "2048", "0.9"],
];

describe("isNumericColumn", () => {
  it("recognizes bigint/double/decimal", () => {
    expect(isNumericColumn({ name: "a", type: "bigint" })).toBe(true);
    expect(isNumericColumn({ name: "a", type: "double" })).toBe(true);
    expect(isNumericColumn({ name: "a", type: "decimal(10,2)" })).toBe(true);
  });

  it("rejects varchar/string/timestamp", () => {
    expect(isNumericColumn({ name: "a", type: "varchar" })).toBe(false);
    expect(isNumericColumn({ name: "a", type: "string" })).toBe(false);
    expect(isNumericColumn({ name: "a", type: "timestamp" })).toBe(false);
  });
});

describe("allowedAggregations", () => {
  it("numeric columns expose SUM/AVG/MIN/MAX plus counts", () => {
    const ops = allowedAggregations({ name: "x", type: "bigint" });
    expect(ops).toContain("SUM");
    expect(ops).toContain("AVG");
    expect(ops).toContain("MIN");
    expect(ops).toContain("MAX");
  });

  it("text columns expose only counts", () => {
    const ops = allowedAggregations({ name: "x", type: "varchar" });
    expect(ops).toEqual(["COUNT", "COUNT_DISTINCT"]);
  });
});

describe("aggregate", () => {
  it("groups by a single string column and sums a numeric column", () => {
    const out = aggregate(ROWS, COLUMNS, {
      groupBy: ["region"],
      aggregations: [{ column: "bytes", op: "SUM" }],
    });
    expect(out.columns.map((c) => c.name)).toEqual(["region", "sum_bytes"]);
    const byRegion = new Map(out.rows.map((r) => [r[0], r[1]]));
    expect(byRegion.get("us-east-1")).toBe(String(1024 + 512 + 256));
    expect(byRegion.get("eu-west-1")).toBe("2048");
  });

  it("supports multiple aggregations in one pass", () => {
    const out = aggregate(ROWS, COLUMNS, {
      groupBy: ["region"],
      aggregations: [
        { column: "bytes", op: "AVG" },
        { column: "bytes", op: "MIN" },
        { column: "bytes", op: "MAX" },
      ],
    });
    const us = out.rows.find((r) => r[0] === "us-east-1")!;
    expect(us[2]).toBe("256");
    expect(us[3]).toBe("1024");
  });

  it("composes group keys across multiple columns", () => {
    const out = aggregate(ROWS, COLUMNS, {
      groupBy: ["region", "status"],
      aggregations: [{ column: "bytes", op: "COUNT" }],
    });
    expect(out.rows).toHaveLength(3);
    const okUs = out.rows.find((r) => r[0] === "us-east-1" && r[1] === "ok");
    expect(okUs?.[2]).toBe("2");
  });

  it("COUNT_DISTINCT skips empty cells", () => {
    const out = aggregate(ROWS, COLUMNS, {
      groupBy: ["region"],
      aggregations: [{ column: "ratio", op: "COUNT_DISTINCT" }],
    });
    const us = out.rows.find((r) => r[0] === "us-east-1")!;
    // ratio for us-east-1: "0.5", "0.1", "" → 2 distinct non-empty values
    expect(us[1]).toBe("2");
  });

  it("SUM skips cells that don't parse as numbers", () => {
    const out = aggregate(ROWS, COLUMNS, {
      groupBy: ["region"],
      aggregations: [{ column: "ratio", op: "SUM" }],
    });
    const us = out.rows.find((r) => r[0] === "us-east-1")!;
    expect(Number(us[1])).toBeCloseTo(0.6);
  });

  it("throws on unknown column name", () => {
    expect(() =>
      aggregate(ROWS, COLUMNS, {
        groupBy: ["missing"],
        aggregations: [],
      })
    ).toThrow(/Unknown column/);
  });
});
