import type { SchemaElement } from "hyparquet";
import { describe, expect, it } from "vitest";

import {
  inferJsonSchema,
  inferJsonlSchema,
  parquetSchemaToColumns,
} from "./schemaInference.js";

describe("inferJsonlSchema", () => {
  it("unions keys across records in first-seen order", () => {
    const text = `
      {"a": 1, "b": "x"}
      {"b": "y", "c": true}
    `;
    const cols = inferJsonlSchema(text, 10);
    expect(cols.map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("infers bigint for all-integer, double for mixed numeric, boolean for all-bool", () => {
    const cols = inferJsonlSchema(
      '{"n":1,"d":1.5,"b":true}\n{"n":2,"d":3,"b":false}',
      10
    );
    const byName = Object.fromEntries(cols.map((c) => [c.name, c.type]));
    expect(byName.n).toBe("bigint");
    expect(byName.d).toBe("double");
    expect(byName.b).toBe("boolean");
  });

  it("infers timestamp when all values match ISO-8601", () => {
    const cols = inferJsonlSchema(
      '{"ts":"2026-01-01T00:00:00Z"}\n{"ts":"2026-02-01"}',
      10
    );
    expect(cols[0]?.type).toBe("timestamp");
  });

  it("defaults to string for nested arrays/objects", () => {
    const cols = inferJsonlSchema(
      '{"arr":[1,2]}\n{"arr":[3,4]}',
      10
    );
    expect(cols[0]?.type).toBe("string");
  });

  it("skips non-object lines gracefully", () => {
    const cols = inferJsonlSchema(
      '"not an object"\n{"x":1}\n{"x":2}',
      10
    );
    expect(cols.map((c) => c.name)).toEqual(["x"]);
  });

  it("returns empty columns for empty text", () => {
    expect(inferJsonlSchema("", 10)).toEqual([]);
    expect(inferJsonlSchema("   \n  ", 10)).toEqual([]);
  });

  it("drops the last line to guard against partial JSON at a range boundary", () => {
    // Last line is intentionally truncated; must not throw.
    const text = '{"x":1}\n{"x":2}\n{"x": ';
    const cols = inferJsonlSchema(text, 10);
    expect(cols[0]?.name).toBe("x");
  });
});

describe("inferJsonSchema", () => {
  it("reads an array of records", () => {
    const cols = inferJsonSchema('[{"a":1},{"a":2,"b":"x"}]', 10);
    expect(cols.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("reads a single top-level object", () => {
    const cols = inferJsonSchema('{"a":1,"b":"x"}', 10);
    expect(cols.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("throws for a primitive or empty-array shape", () => {
    expect(() => inferJsonSchema("42", 10)).toThrow();
    expect(() => inferJsonSchema("[]", 10)).toThrow();
    expect(() => inferJsonSchema("[1,2,3]", 10)).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => inferJsonSchema("{not json", 10)).toThrow();
  });
});

function el(overrides: Partial<SchemaElement>): SchemaElement {
  return { name: "col", ...overrides } as SchemaElement;
}

describe("parquetSchemaToColumns", () => {
  it("skips schema[0] (root group) and keeps primitive columns", () => {
    const schema: SchemaElement[] = [
      el({ name: "schema", num_children: 3 }),
      el({ name: "id", type: "INT64" }),
      el({ name: "name", type: "BYTE_ARRAY", logical_type: { type: "STRING" } }),
      el({ name: "score", type: "DOUBLE" }),
    ];
    const cols = parquetSchemaToColumns(schema);
    expect(cols).toEqual([
      { name: "id", type: "bigint" },
      { name: "name", type: "string" },
      { name: "score", type: "double" },
    ]);
  });

  it("maps the full set of primitive Parquet types to Athena types", () => {
    const schema: SchemaElement[] = [
      el({ name: "schema", num_children: 6 }),
      el({ name: "a", type: "INT32" }),
      el({ name: "b", type: "FLOAT" }),
      el({ name: "c", type: "BOOLEAN" }),
      el({ name: "d", type: "INT96" }),
      el({ name: "e", type: "FIXED_LEN_BYTE_ARRAY" }),
      el({ name: "f", type: "BYTE_ARRAY" }),
    ];
    const cols = parquetSchemaToColumns(schema);
    expect(cols.map((c) => c.type)).toEqual([
      "int",
      "float",
      "boolean",
      "timestamp",
      "string",
      "string",
    ]);
  });

});

describe("parquetSchemaToColumns — logical types + edge cases", () => {
  it("honors logical types for TIMESTAMP / DATE / DECIMAL", () => {
    const schema: SchemaElement[] = [
      el({ name: "schema", num_children: 3 }),
      el({
        name: "ts",
        type: "INT64",
        logical_type: { type: "TIMESTAMP", isAdjustedToUTC: true, unit: "MILLIS" },
      }),
      el({ name: "d", type: "INT32", logical_type: { type: "DATE" } }),
      el({
        name: "price",
        type: "FIXED_LEN_BYTE_ARRAY",
        logical_type: { type: "DECIMAL", precision: 10, scale: 2 },
        precision: 10,
        scale: 2,
      }),
    ];
    const cols = parquetSchemaToColumns(schema);
    expect(cols).toEqual([
      { name: "ts", type: "timestamp" },
      { name: "d", type: "date" },
      { name: "price", type: "decimal(10,2)" },
    ]);
  });

  it("skips nested group columns", () => {
    const schema: SchemaElement[] = [
      el({ name: "schema", num_children: 2 }),
      el({ name: "id", type: "INT64" }),
      el({ name: "nested", num_children: 2 }),
      el({ name: "inner1", type: "INT32" }),
      el({ name: "inner2", type: "DOUBLE" }),
    ];
    const cols = parquetSchemaToColumns(schema);
    // Only top-level `id` survives; nested subtree is dropped.
    expect(cols.map((c) => c.name)).toEqual(["id", "inner1", "inner2"]);
    // (We keep the leaf children; we skip the group container itself.
    // Users with deeply nested schemas can hand-edit in the modal.)
  });

  it("sanitizes column names for Athena identifier rules", () => {
    const schema: SchemaElement[] = [
      el({ name: "schema", num_children: 2 }),
      el({ name: "User Email", type: "BYTE_ARRAY" }),
      el({ name: "123abc", type: "INT32" }),
    ];
    const cols = parquetSchemaToColumns(schema);
    expect(cols[0]?.name).toBe("user_email");
    expect(cols[1]?.name).toBe("_123abc");
  });
});
