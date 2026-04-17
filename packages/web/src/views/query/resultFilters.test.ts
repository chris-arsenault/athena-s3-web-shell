import { describe, expect, it } from "vitest";

import type { ResultColumn } from "@athena-shell/shared";

import {
  applyFilters,
  clearColumnFilter,
  distinctValues,
  hasActiveFilters,
  setColumnSearch,
  setColumnValues,
  type FilterState,
} from "./resultFilters";

const COLUMNS: ResultColumn[] = [
  { name: "region", type: "varchar" },
  { name: "status", type: "varchar" },
  { name: "bytes", type: "bigint" },
];

const ROWS: string[][] = [
  ["us-east-1", "ok", "1024"],
  ["us-east-1", "fail", "512"],
  ["eu-west-1", "ok", "2048"],
  ["ap-south-1", "FAIL", "256"],
];

function empty(): FilterState {
  return new Map();
}

describe("applyFilters", () => {
  it("returns all rows when state is empty", () => {
    expect(applyFilters(ROWS, COLUMNS, empty())).toEqual(ROWS);
  });

  it("filters by case-insensitive substring search", () => {
    const state = setColumnSearch(empty(), "status", "fail");
    const r = applyFilters(ROWS, COLUMNS, state);
    expect(r.map((row) => row[1])).toEqual(["fail", "FAIL"]);
  });

  it("filters by distinct-value set", () => {
    const state = setColumnValues(empty(), "region", new Set(["us-east-1"]));
    const r = applyFilters(ROWS, COLUMNS, state);
    expect(r).toHaveLength(2);
    expect(r.every((row) => row[0] === "us-east-1")).toBe(true);
  });

  it("ANDs across columns", () => {
    let state = setColumnValues(empty(), "region", new Set(["us-east-1"]));
    state = setColumnSearch(state, "status", "ok");
    const r = applyFilters(ROWS, COLUMNS, state);
    expect(r).toEqual([["us-east-1", "ok", "1024"]]);
  });

  it("ignores filters on unknown columns", () => {
    const state = setColumnSearch(empty(), "missing", "x");
    expect(applyFilters(ROWS, COLUMNS, state)).toEqual(ROWS);
  });
});

describe("hasActiveFilters", () => {
  it("returns false for empty state", () => {
    expect(hasActiveFilters(empty())).toBe(false);
  });

  it("returns true when any column has a search", () => {
    expect(hasActiveFilters(setColumnSearch(empty(), "region", "x"))).toBe(true);
  });

  it("returns true when any column has a value filter", () => {
    expect(
      hasActiveFilters(setColumnValues(empty(), "region", new Set(["us-east-1"])))
    ).toBe(true);
  });
});

describe("distinctValues", () => {
  it("returns entries sorted by count desc", () => {
    const r = distinctValues(ROWS, 0);
    expect(r[0]).toEqual({ value: "us-east-1", count: 2 });
  });

  it("returns top-N entries", () => {
    const many: string[][] = Array.from({ length: 50 }, (_, i) => [`v${i % 10}`]);
    const r = distinctValues(many, 0, 3);
    expect(r).toHaveLength(3);
  });
});

describe("clearColumnFilter", () => {
  it("removes the column entry", () => {
    const state = setColumnSearch(empty(), "region", "x");
    const cleared = clearColumnFilter(state, "region");
    expect(hasActiveFilters(cleared)).toBe(false);
  });
});
