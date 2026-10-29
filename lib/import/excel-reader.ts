// The real Excel / CSV reader (SheetJS). No AI unless asked to by `hints.suggestColumns`:
//   - .xlsx / .xls / .csv; formulas arrive as their calculated values; every visible sheet is read
//   - the header row is found by looking (title rows and blank rows above it are fine)
//   - columns are placed by saved mappings, then name similarity (column-match.ts)
//   - columns still unplaced go, once, to hints.suggestColumns, and come back as "confirm"
//   - dates, Indian amounts, GSTINs and vehicle numbers are tidied per column (sheet-cells.ts)
// Sheets that don't have the first sheet's columns (a summary tab, say) are left out; those that
// do (one tab per month) are added to the same list of rows.
import * as XLSX from "xlsx";
import { buildQuestion, applySuggestions } from "./column-suggest";
import {
  freeFields,
  guessColumns,
  looksLikeKnownHeader,
  normaliseHeader,
  type ColumnGuess,
} from "./column-match";
import { SKIP_FIELD } from "./fields";
import { cellText, tidyForField } from "./sheet-cells";
import type { ExcelColumn, ExcelHints, ExcelReadResult, ExcelRow, ReaderFile } from "./types";

export const MAX_ROWS = 5000;
/** Rows above the header (titles, company name, filters) that are searched for it. */
const HEADER_SEARCH_ROWS = 40;
/** A sheet whose columns overlap the first sheet's by at least this much is read as more of it. */
const SAME_TABLE = 0.6;

type Grid = { rowNo: number; cells: string[] }[];

const isXlsBinary = (b: Uint8Array) =>
  (b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11);

/** CSV bytes → text: UTF-8 (with or without BOM), else the Windows code page Excel saves in. */
function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function openWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  try {
    return isXlsBinary(bytes)
      ? XLSX.read(bytes, { type: "array", cellNF: true, cellFormula: false, cellDates: false })
      : // raw: CSV cells stay as typed ("00123", "1,84,902.58", "15-10-2026") — we read them ourselves
        XLSX.read(decodeCsv(bytes), { type: "string", raw: true });
  } catch {
    throw new Error("Couldn't open this file as a spreadsheet. Is it password-protected or damaged?");
  }
}

/** Non-empty rows of a sheet as text, keyed by the sheet's own row number. Sparse: no huge blank ranges. */
function sheetGrid(wb: XLSX.WorkBook, name: string): Grid {
  const ws = wb.Sheets[name];
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const isDate = (fmt: string): boolean => Boolean(XLSX.SSF.is_date(fmt));
  const byRow = new Map<number, string[]>();
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith("!")) continue;
    const { r, c } = XLSX.utils.decode_cell(addr);
    const text = cellText(ws[addr] as XLSX.CellObject, isDate, date1904);
    if (!text) continue;
    const row = byRow.get(r) ?? [];
    row[c] = text;
    byRow.set(r, row);
  }
  return [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([r, cells]) => ({ rowNo: r + 1, cells: Array.from(cells, (x) => x ?? "") }));
}

const looksNumeric = (s: string) => /^[\d.,\-/\s₹%:]+$/.test(s);

/**
 * Index (in the grid) of the header row: the first row in the top 40 that looks most like one —
 * mostly words, as many known header names as possible, with data under it.
 */
export function findHeaderRow(grid: Grid, knownHeaders: Set<string> = new Set()): number {
  let best = -1;
  let bestScore = -1;
  const limit = Math.min(grid.length - 1, HEADER_SEARCH_ROWS); // needs a row below it
  for (let i = 0; i < limit; i++) {
    if (grid[i].rowNo > HEADER_SEARCH_ROWS) break;
    const filled = grid[i].cells.filter(Boolean);
    const words = filled.filter((c) => !looksNumeric(c));
    if (filled.length < 2 || words.length / filled.length < 0.8) continue;
    const known = words.filter(
      (w) => knownHeaders.has(normaliseHeader(w)) || looksLikeKnownHeader(w),
    ).length;
    const score = known * 10 + words.length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

const columnLetter = (i: number) => XLSX.utils.encode_col(i);

type SheetTable = {
  name: string;
  headerRow: number;
  /** One per column kept, in order; `index` is the column in the sheet. */
  headers: { header: string; index: number }[];
  rows: { rowNo: number; cells: string[] }[];
};

/** Header texts made unique and non-empty; columns with no header and no data are dropped. */
function tableOf(name: string, grid: Grid, knownHeaders: Set<string>): SheetTable | null {
  const at = findHeaderRow(grid, knownHeaders);
  if (at < 0) return null;
  const head = grid[at];
  const body = grid.slice(at + 1);
  const seen = new Map<string, number>();
  const headers: SheetTable["headers"] = [];
  const width = Math.max(head.cells.length, ...body.map((r) => r.cells.length));
  for (let i = 0; i < width; i++) {
    let h = head.cells[i] ?? "";
    if (!h) {
      if (!body.some((r) => r.cells[i])) continue;
      h = `Column ${columnLetter(i)}`;
    }
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    headers.push({ header: n > 1 ? `${h} (${n})` : h, index: i });
  }
  const headKey = head.cells.map(normaliseHeader);
  const rows = body.filter((r) => {
    const first = r.cells.find(Boolean) ?? "";
    if (/^(grand\s+)?total\b/i.test(first)) return false; // sum row at the bottom
    const repeats = r.cells.filter((c, i) => c && normaliseHeader(c) === headKey[i]).length;
    return repeats < Math.max(2, r.cells.filter(Boolean).length * 0.6); // header repeated on a new page
  });
  return { name, headerRow: head.rowNo, headers, rows };
}

/** How many of the sheet's columns the name/saved matching can place. */
const placed = (guesses: ColumnGuess[]) => guesses.filter((g) => g.via !== "none").length;

export async function readExcel(file: ReaderFile, hints: ExcelHints = {}): Promise<ExcelReadResult> {
  const wb = openWorkbook(file.bytes);
  const hidden = new Set(
    (wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden).map((s) => s.name),
  );
  const savedHeaders = new Set(
    (hints.savedMappings ?? []).flatMap((m) => Object.keys(m).map(normaliseHeader)),
  );
  const saved = hints.savedMappings ?? [];

  const tables = wb.SheetNames.filter((n) => !hidden.has(n))
    .map((n) => tableOf(n, sheetGrid(wb, n), savedHeaders))
    .filter((t): t is SheetTable => t !== null && t.headers.length > 0 && t.rows.length > 0);
  if (!tables.length) {
    throw new Error("No table found: the file has no header row with data under it.");
  }

  // The sheet with the most placeable columns leads (then the most rows); the others join if they match it.
  const scored = tables.map((t) => {
    const guesses = guessColumns(t.headers.map((h) => h.header), saved);
    return { t, guesses, score: placed(guesses) * 100000 + t.rows.length };
  });
  scored.sort((a, b) => b.score - a.score);
  const main = scored[0];
  const mainKeys = main.t.headers.map((h) => normaliseHeader(h.header));
  const joined = scored.slice(1).filter(({ t }) => {
    const keys = new Set(t.headers.map((h) => normaliseHeader(h.header)));
    return mainKeys.filter((k) => keys.has(k)).length / mainKeys.length >= SAME_TABLE;
  });

  // Rows, keyed by the main sheet's headers.
  const headers = main.t.headers.map((h) => h.header);
  const rows: ExcelRow[] = main.t.rows.map((r) => ({
    rowNo: r.rowNo,
    cells: Object.fromEntries(main.t.headers.map((h) => [h.header, r.cells[h.index] ?? ""])),
  }));
  for (const { t } of joined) {
    const byKey = new Map(t.headers.map((h) => [normaliseHeader(h.header), h.index]));
    const base = rows.reduce((m, r) => Math.max(m, r.rowNo), 0);
    for (const r of t.rows) {
      rows.push({
        rowNo: base + r.rowNo,
        sheet: t.name,
        sheetRow: r.rowNo,
        cells: Object.fromEntries(
          headers.map((h) => {
            const i = byKey.get(normaliseHeader(h));
            return [h, i === undefined ? "" : (r.cells[i] ?? "")];
          }),
        ),
      });
    }
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(
      `The file has more than ${MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`,
    );
  }

  // Columns nothing placed: one question to Gemini, header names + 3 sample rows only.
  let guesses = main.guesses;
  if (hints.suggestColumns) {
    const question = buildQuestion(guesses, rows, freeFields(guesses));
    const answer = question ? await hints.suggestColumns(question) : null;
    if (question && answer) guesses = applySuggestions(guesses, question, answer);
  }

  // Tidy each column for the field it feeds, then describe the columns.
  const fieldOf = new Map(guesses.map((g) => [g.header, g.field]));
  for (const row of rows) {
    for (const h of headers) {
      const field = fieldOf.get(h);
      if (field && field !== SKIP_FIELD) row.cells[h] = tidyForField(field, row.cells[h]);
    }
  }
  const columns: ExcelColumn[] = guesses.map((g) => ({
    header: g.header,
    sample: rows.find((r) => r.cells[g.header])?.cells[g.header] ?? "",
    suggestedField: g.field,
    confidence: g.confidence,
  }));

  return {
    kind: "excel",
    sheetName: [main, ...joined].map((s) => s.t.name).join(", "),
    headerRow: main.t.headerRow,
    columns,
    rows,
  };
}
