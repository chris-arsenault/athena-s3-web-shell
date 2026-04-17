import { describe, expect, it } from "vitest";

import {
  detectJsonArray,
  detectNullTokens,
  detectSerdeMismatch,
  detectTypeMismatches,
} from "./findingsDetector.js";

describe("detectTypeMismatches", () => {
  it("flags DATE column with non-ISO values", () => {
    const cols = [{ name: "subscription_date", type: "date" }];
    const rows = [["2024-01-15"], ["2021-11-11"], ["invalid-date"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.column).toBe("subscription_date");
    expect(out[0]?.sampleBadValues).toContain("invalid-date");
  });

  it("flags BIGINT column with 'N/A' values", () => {
    const cols = [{ name: "amount", type: "bigint" }];
    const rows = [["100"], ["200"], ["N/A"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.column).toBe("amount");
  });

  it("does not flag clean BIGINT column", () => {
    const cols = [{ name: "amount", type: "bigint" }];
    const rows = [["100"], ["200"], ["300"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toEqual([]);
  });

  it("ignores STRING columns (no check)", () => {
    const cols = [{ name: "name", type: "string" }];
    const rows = [["Alice"], ["Bob"], [""]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toEqual([]);
  });

  it("skips empty cells (empty string means absent, not malformed)", () => {
    const cols = [{ name: "amount", type: "bigint" }];
    const rows = [["100"], [""], ["200"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toEqual([]);
  });

  it("handles decimal(p,s) parameter form — base type drives strict check", () => {
    const cols = [{ name: "price", type: "decimal(10,2)" }];
    const rows = [["12.34"], ["bad"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.column).toBe("price");
  });

  it("flags BIGINT values beyond Number.MAX_SAFE_INTEGER even though regex passes", () => {
    const cols = [{ name: "big", type: "bigint" }];
    const rows = [["100"], ["9999999999999999999"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
  });

  it("flags DATE values that are regex-shaped but semantically invalid (2024-00-31)", () => {
    const cols = [{ name: "d", type: "date" }];
    const rows = [["2024-01-15"], ["2024-00-31"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
  });

  it("flags BIGINT values with leading zeros (identifier-as-number)", () => {
    const cols = [{ name: "sku", type: "bigint" }];
    const rows = [["100"], ["007"]];
    const out = detectTypeMismatches(cols, rows);
    expect(out).toHaveLength(1);
  });
});

describe("detectNullTokens", () => {
  it("flags 'N/A' when it appears in ≥20% of rows", () => {
    const cols = [{ name: "amount", type: "string" }];
    const rows = [["100"], ["N/A"], ["200"], ["N/A"], ["300"]];
    const out = detectNullTokens(cols, rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.token).toBe("N/A");
  });

  it("does NOT flag empty strings", () => {
    const cols = [{ name: "amount", type: "string" }];
    const rows = [["100"], [""], [""], [""], [""]];
    const out = detectNullTokens(cols, rows);
    expect(out).toEqual([]);
  });

  it("does not flag when token is below threshold", () => {
    const cols = [{ name: "amount", type: "string" }];
    const rows = [["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["N/A"]];
    // 1/10 = 10% — below 20% threshold
    const out = detectNullTokens(cols, rows);
    expect(out).toEqual([]);
  });

  it("recognizes multiple candidate tokens per column", () => {
    const cols = [{ name: "status", type: "string" }];
    const rows = [["ok"], ["-"], ["-"], ["-"], ["ok"]];
    const out = detectNullTokens(cols, rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.token).toBe("-");
  });
});

describe("detectJsonArray", () => {
  it("flags json file starting with [", () => {
    const out = detectJsonArray("json", "[{\"id\": 1}]");
    expect(out?.kind).toBe("json-array");
    expect(out?.severity).toBe("block");
  });

  it("ignores leading whitespace", () => {
    const out = detectJsonArray("json", "\n  [{}]");
    expect(out).not.toBeNull();
  });

  it("returns null for jsonl", () => {
    expect(detectJsonArray("jsonl", "[{}]")).toBeNull();
  });

  it("returns null for non-array json (object)", () => {
    expect(detectJsonArray("json", "{\"x\":1}")).toBeNull();
  });

  it("returns null for csv", () => {
    expect(detectJsonArray("csv", "[1,2,3]")).toBeNull();
  });
});

describe("detectSerdeMismatch", () => {
  it("flags CSV with quoted embedded commas", () => {
    const out = detectSerdeMismatch(
      "csv",
      'name,address\nAlice,"100 Main, Apt 2"\n',
      ","
    );
    expect(out?.kind).toBe("serde-mismatch");
  });

  it("does not flag plain CSV", () => {
    expect(
      detectSerdeMismatch("csv", "name,amount\nAlice,100\n", ",")
    ).toBeNull();
  });

  it("does not flag non-CSV file types", () => {
    expect(detectSerdeMismatch("json", 'x",1"y', undefined)).toBeNull();
  });
});
