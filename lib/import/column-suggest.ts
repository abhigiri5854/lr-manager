// The pure half of the optional Gemini column step: what is sent (header names + 3 sample rows,
// never the sheet) and how the answer is checked before it is allowed to change a mapping.
// The call itself is in readers/gemini-columns.ts.
import type { ColumnGuess } from "./column-match";
import { EXCEL_FIELDS, SKIP_FIELD } from "./fields";

export const SAMPLE_ROWS = 3;
const MAX_CELL_CHARS = 60;

export type ColumnQuestion = {
  /** Every header, in sheet order, so the model sees the context. */
  headers: string[];
  /** Up to 3 rows, each one value per header. */
  sampleRows: string[][];
  /** Headers that have no mapping yet: the only ones it is asked about. */
  unmapped: string[];
  /** System fields not yet taken by another column. */
  freeFields: { key: string; label: string }[];
};

/** The columns nothing matched, or null when there is nothing to ask. */
export function buildQuestion(
  guesses: ColumnGuess[],
  rows: { cells: Record<string, string> }[],
  free: string[],
): ColumnQuestion | null {
  const unmapped = guesses
    .filter((g) => g.via === "none" && rows.some((r) => (r.cells[g.header] ?? "") !== ""))
    .map((g) => g.header);
  if (!unmapped.length || !free.length) return null;
  const headers = guesses.map((g) => g.header);
  const sampleRows = rows
    .filter((r) => unmapped.some((h) => (r.cells[h] ?? "") !== ""))
    .slice(0, SAMPLE_ROWS)
    .map((r) => headers.map((h) => (r.cells[h] ?? "").slice(0, MAX_CELL_CHARS)));
  return {
    headers,
    sampleRows,
    unmapped,
    freeFields: EXCEL_FIELDS.filter((f) => free.includes(f.key)).map(({ key, label }) => ({ key, label })),
  };
}

/**
 * Keeps only suggestions for a header that was asked about, naming a field that is still free,
 * once per field. Everything it keeps is "confirm": the user checks Gemini's guess.
 */
export function applySuggestions(
  guesses: ColumnGuess[],
  question: ColumnQuestion,
  answer: { header: string; field: string }[],
): ColumnGuess[] {
  const free = new Set(question.freeFields.map((f) => f.key));
  const asked = new Set(question.unmapped);
  const picked = new Map<string, string>();
  for (const a of answer) {
    if (!asked.has(a.header) || picked.has(a.header)) continue;
    if (a.field === SKIP_FIELD || !free.has(a.field)) continue;
    picked.set(a.header, a.field);
    free.delete(a.field);
  }
  return guesses.map((g) => {
    const field = picked.get(g.header);
    return field ? { header: g.header, field, confidence: "confirm", via: "name" } : g;
  });
}
