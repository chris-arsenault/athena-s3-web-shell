import { describe, expect, it, vi } from "vitest";

// Mock monaco-editor: we only touch the CompletionItemKind enum at runtime.
// Types are compile-time only. Sparing the test from loading the full editor
// bundle keeps these tests fast + avoids jsdom/canvas issues.
vi.mock("monaco-editor", () => ({
  languages: {
    CompletionItemKind: {
      Keyword: 17,
      Module: 8,
      Class: 6,
      Field: 4,
    },
  },
}));

import type * as monaco from "monaco-editor";

import type { Column, DatabaseRef, TableRef } from "@athena-shell/shared";

import type { SchemaValue } from "../../data/schemaContext";
import { buildSuggestions } from "./sqlCompletions";

// ---------------------------------------------------------------------------
// Test helpers

function mockModel(lines: string[]): monaco.editor.ITextModel {
  const getWordUntilPosition = (pos: monaco.Position) => {
    const line = lines[pos.lineNumber - 1] ?? "";
    let start = pos.column;
    while (start > 1 && /[A-Za-z0-9_]/.test(line[start - 2] ?? "")) start--;
    let end = pos.column;
    while (end <= line.length && /[A-Za-z0-9_]/.test(line[end - 1] ?? "")) end++;
    return {
      word: line.slice(start - 1, end - 1),
      startColumn: start,
      endColumn: end,
    };
  };
  return {
    getLineContent: (n: number) => lines[n - 1] ?? "",
    getWordUntilPosition,
  } as unknown as monaco.editor.ITextModel;
}

function pos(lineNumber: number, column: number): monaco.Position {
  return { lineNumber, column } as unknown as monaco.Position;
}

function makeSchema(overrides: Partial<SchemaValue> = {}): SchemaValue {
  return {
    databases: [],
    tablesByDb: {},
    columnsByTable: {},
    loadTables: async () => [],
    loadColumns: async () => [],
    refresh: async () => undefined,
    ...overrides,
  };
}

function items(
  result: monaco.languages.ProviderResult<monaco.languages.CompletionList>
): monaco.languages.CompletionItem[] {
  if (!result) throw new Error("Expected a CompletionList");
  const maybeThenable = result as { then?: unknown };
  if (typeof maybeThenable.then === "function") {
    throw new Error("Expected synchronous CompletionList");
  }
  return (result as monaco.languages.CompletionList).suggestions;
}

async function asyncItems(
  result: monaco.languages.ProviderResult<monaco.languages.CompletionList>
): Promise<monaco.languages.CompletionItem[]> {
  const awaited = await result;
  return awaited?.suggestions ?? [];
}

const DB_DEFAULT: DatabaseRef = { name: "default" };
const DB_SALES: DatabaseRef = { name: "sales" };
const TBL_EVENTS: TableRef = { name: "events", database: "default" };
const TBL_ORDERS: TableRef = { name: "orders", database: "sales" };
const TBL_CUSTOMERS: TableRef = { name: "customers", database: "sales" };
const COL_EVENT_ID: Column = { name: "event_id", type: "string" };
const COL_ORDER_ID: Column = { name: "order_id", type: "bigint" };
const COL_AMOUNT: Column = { name: "amount", type: "decimal(10,2)" };

// ---------------------------------------------------------------------------
// Unqualified

describe("buildSuggestions — unqualified", () => {
  it("includes keywords, databases, tables, and cached columns", () => {
    const schema = makeSchema({
      databases: [DB_DEFAULT, DB_SALES],
      tablesByDb: { default: [TBL_EVENTS] },
      columnsByTable: { "default.events": [COL_EVENT_ID] },
    });
    const result = buildSuggestions(mockModel(["SELECT "]), pos(1, 8), schema);
    const labels = items(result).map((s) => s.label);
    expect(labels).toContain("SELECT");
    expect(labels).toContain("default");
    expect(labels).toContain("events");
    expect(labels).toContain("event_id");
  });

  it("sorts databases before tables before columns before keywords", () => {
    const schema = makeSchema({
      databases: [DB_SALES],
      tablesByDb: { sales: [TBL_ORDERS] },
      columnsByTable: { "sales.orders": [COL_ORDER_ID] },
    });
    const result = buildSuggestions(mockModel(["SELECT "]), pos(1, 8), schema);
    const bySortText = items(result).sort((a, b) =>
      String(a.sortText).localeCompare(String(b.sortText))
    );
    const firstFour = bySortText.slice(0, 4).map((s) => s.label);
    expect(firstFour[0]).toBe("sales"); // 1_
    expect(firstFour[1]).toBe("orders"); // 2_
    expect(firstFour[2]).toBe("order_id"); // 3_
  });

  it("survives a null databases list (schema still loading)", () => {
    const schema = makeSchema({ databases: null });
    const result = buildSuggestions(mockModel(["SELECT "]), pos(1, 8), schema);
    const suggestions = items(result);
    // Keywords still present even when the catalog isn't loaded yet.
    expect(suggestions.some((s) => s.label === "SELECT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Qualified on `db.`

describe("buildSuggestions — db. qualifier", () => {
  it("returns tables of the matched database", () => {
    const schema = makeSchema({
      databases: [DB_SALES],
      tablesByDb: { sales: [TBL_ORDERS, TBL_CUSTOMERS] },
    });
    const line = "SELECT * FROM sales.";
    const result = buildSuggestions(mockModel([line]), pos(1, line.length + 1), schema);
    const labels = items(result).map((s) => s.label);
    expect(labels).toEqual(["orders", "customers"]);
  });

  it("returns empty when qualifier isn't a known db or table", () => {
    const schema = makeSchema({ databases: [DB_SALES], tablesByDb: { sales: [] } });
    const line = "SELECT * FROM bogus.";
    const result = buildSuggestions(mockModel([line]), pos(1, line.length + 1), schema);
    expect(items(result)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Qualified on `table.`

describe("buildSuggestions — table. qualifier", () => {
  it("returns cached columns synchronously", () => {
    const schema = makeSchema({
      databases: [DB_SALES],
      tablesByDb: { sales: [TBL_ORDERS] },
      columnsByTable: { "sales.orders": [COL_ORDER_ID, COL_AMOUNT] },
    });
    const line = "SELECT * FROM orders.";
    const result = buildSuggestions(mockModel([line]), pos(1, line.length + 1), schema);
    const labels = items(result).map((s) => s.label);
    expect(labels).toEqual(["order_id", "amount"]);
  });

  it("lazy-loads columns when not cached (returns a Promise)", async () => {
    let loadCalled = "";
    const schema = makeSchema({
      databases: [DB_SALES],
      tablesByDb: { sales: [TBL_ORDERS] },
      columnsByTable: {},
      loadColumns: async (db, table) => {
        loadCalled = `${db}.${table}`;
        return [COL_ORDER_ID];
      },
    });
    const line = "SELECT * FROM orders.";
    const result = buildSuggestions(mockModel([line]), pos(1, line.length + 1), schema);
    const labels = (await asyncItems(result)).map((s) => s.label);
    expect(loadCalled).toBe("sales.orders");
    expect(labels).toEqual(["order_id"]);
  });
});

// ---------------------------------------------------------------------------
// Range

describe("buildSuggestions — range", () => {
  it("uses the current word bounds so completions replace in-place", () => {
    const schema = makeSchema({ databases: [DB_DEFAULT] });
    const line = "SELECT evt";
    const result = buildSuggestions(mockModel([line]), pos(1, line.length + 1), schema);
    const range = items(result)[0]?.range;
    expect(range).toMatchObject({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 8,
      endColumn: 11,
    });
  });
});
