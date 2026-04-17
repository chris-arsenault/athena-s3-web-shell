import { describe, expect, it } from "vitest";

import { sqlFingerprint } from "./audit.js";

describe("sqlFingerprint — redaction", () => {
  it("strips -- line comments", () => {
    expect(sqlFingerprint("SELECT 1 -- comment here").sqlFingerprint).toBe(
      "SELECT ?"
    );
  });

  it("strips /* block */ comments (including multi-line)", () => {
    expect(
      sqlFingerprint("SELECT /* PII: alice@x */\n  1 FROM t").sqlFingerprint
    ).toBe("SELECT ? FROM t");
  });

  it("replaces single-quoted string literals with '?'", () => {
    expect(
      sqlFingerprint("WHERE email = 'alice@example.com'").sqlFingerprint
    ).toBe("WHERE email = '?'");
  });

  it("handles embedded single quotes via the SQL '' escape", () => {
    expect(sqlFingerprint("WHERE name = 'O''Brien'").sqlFingerprint).toBe(
      "WHERE name = '?'"
    );
  });

  it("replaces integer literals with ?", () => {
    expect(sqlFingerprint("LIMIT 100").sqlFingerprint).toBe("LIMIT ?");
  });

  it("replaces decimal literals with ?", () => {
    expect(sqlFingerprint("WHERE amount > 99.95").sqlFingerprint).toBe(
      "WHERE amount > ?"
    );
  });

  it("collapses whitespace and trims", () => {
    expect(sqlFingerprint("SELECT\n  *  \n  FROM   t").sqlFingerprint).toBe(
      "SELECT * FROM t"
    );
  });

  it("keeps identifiers and keywords intact", () => {
    const fp = sqlFingerprint(
      "SELECT customer_id, COUNT(*) FROM sales.orders WHERE amount > 100"
    ).sqlFingerprint;
    expect(fp).toBe(
      "SELECT customer_id, COUNT(*) FROM sales.orders WHERE amount > ?"
    );
  });
});

describe("sqlFingerprint — hash", () => {
  it("is deterministic for identical input", () => {
    expect(sqlFingerprint("SELECT 1").sqlHash).toBe(
      sqlFingerprint("SELECT 1").sqlHash
    );
  });

  it("is 16 hex characters", () => {
    const h = sqlFingerprint("SELECT 1").sqlHash;
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs across distinct query shapes", () => {
    expect(sqlFingerprint("SELECT * FROM events").sqlHash).not.toBe(
      sqlFingerprint("SELECT * FROM orders").sqlHash
    );
  });

  it("is stable across differing literal values (same shape → same hash)", () => {
    expect(sqlFingerprint("SELECT * FROM t WHERE id = 1").sqlHash).toBe(
      sqlFingerprint("SELECT * FROM t WHERE id = 999").sqlHash
    );
    expect(sqlFingerprint("WHERE email = 'alice@x'").sqlHash).toBe(
      sqlFingerprint("WHERE email = 'bob@y'").sqlHash
    );
  });
});

describe("sqlFingerprint — truncation + no-leak", () => {
  it("truncates very long fingerprints with an ellipsis", () => {
    const sql = `SELECT ${"x,".repeat(3000)}y FROM t`;
    const fp = sqlFingerprint(sql).sqlFingerprint;
    expect(fp.length).toBeLessThanOrEqual(4097);
    expect(fp.endsWith("…")).toBe(true);
  });

  it("never leaks comment content", () => {
    const fp = sqlFingerprint(
      "SELECT /* secret_literal_value_abc */ 1"
    ).sqlFingerprint;
    expect(fp).not.toContain("secret_literal_value_abc");
  });

  it("never leaks string literal content", () => {
    const fp = sqlFingerprint("WHERE ssn = '123-45-6789'").sqlFingerprint;
    expect(fp).not.toContain("123-45-6789");
  });

  it("never leaks numeric literal content", () => {
    const fp = sqlFingerprint("WHERE amount = 1234567.89").sqlFingerprint;
    expect(fp).not.toContain("1234567");
    expect(fp).not.toContain("89");
  });
});
