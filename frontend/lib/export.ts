/**
 * Client-side exporters for dataset views.
 *
 * CSV: hand-rolled, no dependencies. Tiny payload, fast.
 * XLSX: dynamically imports `@e965/xlsx` (a maintained SheetJS republish —
 *       the `xlsx` package on npm is frozen at an abandoned 0.18.5) on demand
 *       so the ~700KB library doesn't enter the main bundle. Users who never
 *       click "Export XLSX" never download it.
 */

export interface ExportColumn {
  name: string;
}

export interface ExportRow {
  data: Record<string, unknown>;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value == null) return "";
  let str = String(value);
  // Neutralize spreadsheet formula injection (=, +, -, @).
  if (/^[=+\-@]/.test(str)) {
    str = `'${str}`;
  }
  // RFC 4180: fields containing comma, quote, CR, or LF must be quoted;
  // quotes inside the field are doubled.
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCSV(
  columns: ExportColumn[],
  rows: ExportRow[],
): string {
  const header = columns.map((c) => csvEscape(c.name)).join(",");
  const body = rows
    .map((row) =>
      columns.map((c) => csvEscape(row.data[c.name])).join(","),
    )
    .join("\n");
  // BOM lets Excel open UTF-8 CSV with non-ASCII names correctly.
  return "﻿" + header + "\n" + body + "\n";
}

// ── Filename helpers ────────────────────────────────────────────────────────

function safeFilename(name: string, ext: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "dataset";
  return `${base}.${ext}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // Some browsers require the anchor to be in the DOM.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Public API ──────────────────────────────────────────────────────────────

export function downloadCSV(
  datasetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): void {
  const csv = buildCSV(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, safeFilename(datasetName, "csv"));
}

export async function downloadXLSX(
  datasetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<void> {
  // Dynamic import — keeps the ~700KB xlsx library out of the main bundle.
  const XLSX = await import("@e965/xlsx");

  // sheet_aoa expects a 2-D array. First row is headers.
  const aoa: unknown[][] = [
    columns.map((c) => c.name),
    ...rows.map((row) => columns.map((c) => row.data[c.name] ?? "")),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  // Sheet names are limited to 31 chars; truncate datasets like
  // "Browser Automation & Web Agent Companies".
  const sheetName =
    datasetName.replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Dataset";
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  XLSX.writeFile(workbook, safeFilename(datasetName, "xlsx"));
}
