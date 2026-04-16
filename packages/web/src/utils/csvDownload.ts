import type { QueryResultPage } from "@athena-shell/shared";

function escapeCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function resultsToCsv(page: QueryResultPage): string {
  const header = page.columns.map((c) => escapeCell(c.name)).join(",");
  const body = page.rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}

export function downloadBlob(content: string, filename: string, mime = "text/csv"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
