import * as monaco from "monaco-editor";

import type { Column, DatabaseRef, TableRef } from "@athena-shell/shared";

import type { SchemaValue } from "../../data/schemaContext";

const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "LIMIT", "HAVING",
  "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "FULL OUTER JOIN",
  "ON", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN",
  "DISTINCT", "WITH", "UNION", "UNION ALL", "CASE", "WHEN", "THEN", "ELSE", "END",
  "CAST", "COUNT", "SUM", "AVG", "MIN", "MAX", "ASC", "DESC", "EXPLAIN",
  "PARTITION BY", "OVER",
];

type Items = monaco.languages.CompletionItem[];

export function buildSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  schema: SchemaValue
): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
  const word = model.getWordUntilPosition(position);
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  const line = model.getLineContent(position.lineNumber);
  const charBefore = word.startColumn > 1 ? line[word.startColumn - 2] : "";

  if (charBefore === ".") {
    const qualifier = extractQualifier(line, word.startColumn - 2);
    if (qualifier) return qualifiedSuggestions(qualifier, schema, range);
  }

  return { suggestions: unqualifiedSuggestions(schema, range) };
}

function extractQualifier(line: string, dotIndex: number): string | null {
  const before = line.slice(0, dotIndex);
  const m = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
  return m?.[1] ?? null;
}

function qualifiedSuggestions(
  qualifier: string,
  schema: SchemaValue,
  range: monaco.IRange
): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
  const { databases, tablesByDb, columnsByTable, loadColumns } = schema;

  if (databases?.some((d) => d.name === qualifier)) {
    const tables = tablesByDb[qualifier] ?? [];
    return { suggestions: tables.map((t) => tableItem(t, qualifier, range)) };
  }

  const dbForTable = findDbForTable(qualifier, tablesByDb);
  if (!dbForTable) return { suggestions: [] };

  const key = `${dbForTable}.${qualifier}`;
  const cached = columnsByTable[key];
  if (cached) {
    return { suggestions: cached.map((c) => columnItem(c, key, range)) };
  }

  return loadColumns(dbForTable, qualifier).then((cols) => ({
    suggestions: cols.map((c) => columnItem(c, key, range)),
  }));
}

function findDbForTable(
  name: string,
  tablesByDb: Record<string, TableRef[]>
): string | null {
  for (const [db, tables] of Object.entries(tablesByDb)) {
    if (tables.some((t) => t.name === name)) return db;
  }
  return null;
}

function unqualifiedSuggestions(schema: SchemaValue, range: monaco.IRange): Items {
  const items: Items = [];
  pushKeywords(items, range);
  pushDatabases(items, schema.databases, range);
  pushTables(items, schema.tablesByDb, range);
  pushColumns(items, schema.columnsByTable, range);
  return items;
}

function pushKeywords(items: Items, range: monaco.IRange): void {
  for (const kw of SQL_KEYWORDS) {
    items.push({
      label: kw,
      kind: monaco.languages.CompletionItemKind.Keyword,
      insertText: kw,
      range,
      sortText: `9_${kw}`,
    });
  }
}

function pushDatabases(
  items: Items,
  databases: DatabaseRef[] | null,
  range: monaco.IRange
): void {
  for (const db of databases ?? []) {
    items.push(databaseItem(db, range));
  }
}

function pushTables(
  items: Items,
  tablesByDb: Record<string, TableRef[]>,
  range: monaco.IRange
): void {
  for (const [db, tables] of Object.entries(tablesByDb)) {
    for (const t of tables) {
      items.push(tableItem(t, db, range));
    }
  }
}

function pushColumns(
  items: Items,
  columnsByTable: Record<string, Column[]>,
  range: monaco.IRange
): void {
  for (const [key, cols] of Object.entries(columnsByTable)) {
    for (const c of cols) {
      items.push(columnItem(c, key, range));
    }
  }
}

function databaseItem(db: DatabaseRef, range: monaco.IRange): monaco.languages.CompletionItem {
  return {
    label: db.name,
    kind: monaco.languages.CompletionItemKind.Module,
    insertText: db.name,
    detail: "database",
    documentation: db.description,
    range,
    sortText: `1_${db.name}`,
  };
}

function tableItem(t: TableRef, db: string, range: monaco.IRange): monaco.languages.CompletionItem {
  return {
    label: t.name,
    kind: monaco.languages.CompletionItemKind.Class,
    insertText: t.name,
    detail: `table · ${db}`,
    range,
    sortText: `2_${t.name}`,
  };
}

function columnItem(c: Column, tableKey: string, range: monaco.IRange): monaco.languages.CompletionItem {
  return {
    label: c.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: c.name,
    detail: `${c.type}  ·  ${tableKey}`,
    range,
    sortText: `3_${c.name}`,
  };
}
