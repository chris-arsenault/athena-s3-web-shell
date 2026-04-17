import { describe, expect, it } from "vitest";

import { splitStatements, statementAtOffset } from "./splitStatements";

describe("splitStatements", () => {
  it("returns one statement for a buffer with no semicolons", () => {
    const r = splitStatements("SELECT 1");
    expect(r).toHaveLength(1);
    expect(r[0]?.text).toBe("SELECT 1");
    expect(r[0]?.start).toBe(0);
    expect(r[0]?.end).toBe(8);
  });

  it("splits on unquoted semicolons", () => {
    const r = splitStatements("SELECT 1; SELECT 2; SELECT 3");
    expect(r.map((s) => s.text)).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
  });

  it("drops empty statements from consecutive semicolons", () => {
    const r = splitStatements("SELECT 1;;; SELECT 2");
    expect(r.map((s) => s.text)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  it("keeps semicolons inside single-quoted strings", () => {
    const r = splitStatements("SELECT ';'; SELECT 2");
    expect(r.map((s) => s.text)).toEqual(["SELECT ';'", "SELECT 2"]);
  });

  it("handles doubled single-quote escape inside strings", () => {
    const r = splitStatements("SELECT 'it''s;'; SELECT 2");
    expect(r.map((s) => s.text)).toEqual(["SELECT 'it''s;'", "SELECT 2"]);
  });

  it("keeps semicolons inside double-quoted identifiers", () => {
    const r = splitStatements('SELECT "a;b"; SELECT 2');
    expect(r.map((s) => s.text)).toEqual(['SELECT "a;b"', "SELECT 2"]);
  });

  it("ignores semicolons inside -- line comments", () => {
    const r = splitStatements("SELECT 1 -- a;b\n; SELECT 2");
    expect(r).toHaveLength(2);
    expect(r[1]?.text).toBe("SELECT 2");
  });

  it("ignores semicolons inside /* block */ comments", () => {
    const r = splitStatements("SELECT 1 /* a;b */; SELECT 2");
    expect(r.map((s) => s.text)).toEqual([
      "SELECT 1 /* a;b */",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside parens (defensive)", () => {
    const r = splitStatements("SELECT (1;2); SELECT 2");
    expect(r.map((s) => s.text)).toEqual(["SELECT (1;2)", "SELECT 2"]);
  });

  it("emits a trailing statement without a final semicolon", () => {
    const r = splitStatements("SELECT 1;\nSELECT 2");
    expect(r).toHaveLength(2);
    expect(r[1]?.text).toBe("SELECT 2");
  });

  it("returns empty array for blank input", () => {
    expect(splitStatements("")).toEqual([]);
    expect(splitStatements("   \n  ")).toEqual([]);
    expect(splitStatements("-- just a comment\n")).toEqual([]);
  });

  it("tracks start/end offsets that exclude leading/trailing whitespace", () => {
    const sql = "  SELECT 1  ;  SELECT 2  ";
    const r = splitStatements(sql);
    expect(r[0]?.text).toBe("SELECT 1");
    expect(sql.slice(r[0]!.start, r[0]!.end)).toBe("SELECT 1");
    expect(sql.slice(r[1]!.start, r[1]!.end)).toBe("SELECT 2");
  });
});

describe("statementAtOffset", () => {
  const sql = "SELECT 1; SELECT 2; SELECT 3";
  const parts = splitStatements(sql);

  it("returns the statement containing the cursor", () => {
    const stmt = statementAtOffset(parts, sql.indexOf("SELECT 2") + 3);
    expect(stmt?.text).toBe("SELECT 2");
  });

  it("falls back to previous statement when cursor is on a semicolon", () => {
    const stmt = statementAtOffset(parts, sql.indexOf(";"));
    expect(stmt?.text).toBe("SELECT 1");
  });

  it("returns null for an empty splits array", () => {
    expect(statementAtOffset([], 0)).toBeNull();
  });

  it("returns the first statement when cursor is before anything", () => {
    const stmt = statementAtOffset(parts, 0);
    expect(stmt?.text).toBe("SELECT 1");
  });
});
